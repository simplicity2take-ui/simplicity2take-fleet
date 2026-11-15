const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const documentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const source = stripTypeScriptTypes(fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/document-access/index.ts'), 'utf8'
).replace(/^import .*;\r?\n/gm, ''));

function defaults(overrides = {}) {
  return {
    role: 'driver',
    authUser: { id: 'auth-user-1' },
    driver: { id: 'driver-1' },
    document: {
      id: documentId, drive_file_id: 'drive-file-example',
      driver_id: null, vehicle_id: null, expiry_date: null,
      name: 'Exemplo de documento'
    },
    viewers: [],
    assignments: [],
    ...overrides
  };
}

async function invoke(options = {}) {
  const scenario = defaults(options);
  const traces = { tables: [], tokenConfigRead: 0, networkCalls: 0 };
  let handler;

  function query(table) {
    const filters = {};
    const result = (list = false) => {
      if (table === 'documents') return scenario.document;
      if (table === 'profiles') return scenario.role ? { role: scenario.role } : null;
      if (table === 'drivers') return scenario.driver;
      if (table === 'document_viewers') {
        const allowed = scenario.viewers.includes(filters.driver_id) &&
          filters.document_id === documentId && filters.can_view === true;
        return allowed ? { document_id: documentId } : null;
      }
      if (table === 'vehicle_assignments') {
        return scenario.assignments.filter(item =>
          item.vehicle_id === filters.vehicle_id && item.driver_id === filters.driver_id
        );
      }
      throw new Error('Unexpected table: ' + table);
    };
    const chain = {
      select() { return chain; },
      eq(column, value) { filters[column] = value; return chain; },
      async maybeSingle() { return { data: result(), error: null }; },
      then(resolve, reject) {
        return Promise.resolve({ data: result(true), error: null }).then(resolve, reject);
      }
    };
    return chain;
  }

  const createClient = () => ({
    auth: { async getUser() { return { data: { user: scenario.authUser }, error: null }; } },
    from(table) { traces.tables.push(table); return query(table); }
  });
  const context = {
    createClient, Request, Response, Headers, TextEncoder, TextDecoder, URLSearchParams,
    Uint8Array, ArrayBuffer, Intl, Date,
    Deno: {
      env: { get(name) {
        if (name === 'GOOGLE_SERVICE_ACCOUNT_JSON') {
          traces.tokenConfigRead++;
          return null; // Authorized requests stop before contacting Google.
        }
        return 'test-value';
      } },
      serve(callback) { handler = callback; }
    },
    fetch() { traces.networkCalls++; throw new Error('Tests must never reach the network'); },
    console: { error() {} }
  };
  vm.runInNewContext(source, context);
  assert.equal(typeof handler, 'function');
  const headers = scenario.authUser ? { Authorization: 'Bearer test-session' } : {};
  const request = new Request('https://fixture.example.test/documents', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ document_id: options.requestedDocumentId || documentId })
  });
  const response = await handler(request);
  return { response, traces };
}

test('non-authenticated requests cannot read document metadata', async () => {
  const { response, traces } = await invoke({ authUser: null });
  assert.equal(response.status, 401);
  assert.equal(traces.tables.length, 0);
  assert.equal(traces.tokenConfigRead, 0);
});

test('unknown/invalid document IDs are rejected without table reads', async () => {
  const { response, traces } = await invoke({ requestedDocumentId: '../document' });
  assert.equal(response.status, 400);
  assert.equal(traces.tables.length, 0);
});

test('personal documents are visible only to the owning driver', async () => {
  const own = await invoke({ document: { ...defaults().document, driver_id: 'driver-1' } });
  assert.equal(own.response.status, 503);
  assert.equal(own.traces.tokenConfigRead, 1);
  const foreign = await invoke({ document: { ...defaults().document, driver_id: 'driver-2' } });
  assert.equal(foreign.response.status, 403);
  assert.equal(foreign.traces.tokenConfigRead, 0);
});

test('inconsistent document associated with both vehicle and driver is rejected', async () => {
  const { response, traces } = await invoke({
    document: { ...defaults().document, driver_id: 'driver-1', vehicle_id: 'vehicle-1' },
    assignments: [{ vehicle_id: 'vehicle-1', driver_id: 'driver-1', active_from: '2020-01-01', active_until: null }]
  });
  assert.equal(response.status, 403);
  assert.equal(traces.tables.includes('vehicle_assignments'), false);
  assert.equal(traces.tokenConfigRead, 0);
});

test('vehicle files require a currently active assignment to the correct vehicle', async () => {
  const doc = { ...defaults().document, vehicle_id: 'vehicle-1' };
  const noAssignment = await invoke({ document: doc });
  assert.equal(noAssignment.response.status, 403);
  const otherVehicle = await invoke({
    document: doc,
    assignments: [{ vehicle_id: 'vehicle-2', driver_id: 'driver-1', active_from: '2020-01-01', active_until: null }]
  });
  assert.equal(otherVehicle.response.status, 403);
  const otherDriver = await invoke({
    document: doc,
    assignments: [{ vehicle_id: 'vehicle-1', driver_id: 'driver-2', active_from: '2020-01-01', active_until: null }]
  });
  assert.equal(otherDriver.response.status, 403);
  const expired = await invoke({
    document: doc,
    assignments: [{ vehicle_id: 'vehicle-1', driver_id: 'driver-1', active_from: '2020-01-01', active_until: '2020-01-02' }]
  });
  assert.equal(expired.response.status, 403);
  const active = await invoke({
    document: doc,
    assignments: [{ vehicle_id: 'vehicle-1', driver_id: 'driver-1', active_from: '2020-01-01', active_until: null }]
  });
  assert.equal(active.response.status, 503);
});

test('company document access requires an explicit active viewer grant', async () => {
  const withoutGrant = await invoke();
  assert.equal(withoutGrant.response.status, 403);
  assert.equal(withoutGrant.traces.tokenConfigRead, 0);
  const granted = await invoke({ viewers: ['driver-1'] });
  assert.equal(granted.response.status, 503);
  assert.equal(granted.traces.tokenConfigRead, 1);
});

test('expired documents are rejected for drivers even with viewer grants', async () => {
  const { response, traces } = await invoke({
    document: { ...defaults().document, expiry_date: '2020-01-01' },
    viewers: ['driver-1']
  });
  assert.equal(response.status, 403);
  assert.equal(traces.tokenConfigRead, 0);
});

test('administrators can renew expired documents without a viewer grant', async () => {
  const { response, traces } = await invoke({
    role: 'admin',
    document: { ...defaults().document, expiry_date: '2020-01-01' }
  });
  assert.equal(response.status, 503);
  assert.equal(traces.tokenConfigRead, 1);
});

test('unknown roles and unlinked profiles cannot reach Google Drive', async () => {
  for (const options of [{ role: null }, { role: 'unknown' }, { driver: null }]) {
    const { response, traces } = await invoke(options);
    assert.equal(response.status, 403);
    assert.equal(traces.tokenConfigRead, 0);
  }
});

test('authorization checks never use external network resources', async () => {
  const cases = [
    { document: { ...defaults().document, driver_id: 'driver-2' } },
    { document: { ...defaults().document, vehicle_id: 'vehicle-1' } },
    { viewers: [] }
  ];
  for (const scenario of cases) {
    const { traces } = await invoke(scenario);
    assert.equal(traces.networkCalls, 0);
  }
});
