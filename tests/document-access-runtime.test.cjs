const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const { webcrypto, generateKeyPairSync } = require('node:crypto');
const serviceAccount = JSON.stringify({
  client_email: 'fixture@example.invalid',
  private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
});

const documentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const source = stripTypeScriptTypes(fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/document-access/index.ts'), 'utf8'
).replace(/^import .*;\r?\n/gm, ''));

function defaults(overrides = {}) {
  return {
    role: 'driver',
    profileStatus: 'Ativo',
    authUser: { id: 'auth-user-1' },
    driver: { id: 'driver-1', status: 'Ativo' },
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
      if (table === 'profiles') return scenario.role ? { role: scenario.role, status: scenario.profileStatus } : null;
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
    Uint8Array, ArrayBuffer, Intl, Date, atob, btoa, crypto: webcrypto,
    Deno: {
      env: { get(name) {
        if (name === 'GOOGLE_SERVICE_ACCOUNT_JSON') {
          traces.tokenConfigRead++;
          return scenario.media ? serviceAccount : null;
        }
        return 'test-value';
      } },
      serve(callback) { handler = callback; }
    },
    async fetch(url, options) {
      traces.networkCalls++;
      assert.ok(scenario.media, 'Unexpected external request');
      if (url === 'https://oauth2.googleapis.com/token') {
        const claim = JSON.parse(Buffer.from(options.body.get('assertion').split('.')[1], 'base64url'));
        assert.equal(claim.scope, 'https://www.googleapis.com/auth/drive.readonly');
        return Response.json({ access_token: 'fixture-token' });
      }
      assert.equal(url, 'https://www.googleapis.com/drive/v3/files/drive-file-example?alt=media');
      assert.equal(options.headers.Authorization, 'Bearer fixture-token');
      return scenario.media();
    },
    console: { error() {} }
  };
  vm.runInNewContext(source, context);
  assert.equal(typeof handler, 'function');
  const headers = scenario.authUser ? { Authorization: 'Bearer test-session' } : {};
  const request = options.request || new Request('https://fixture.example.test/documents', {
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

test('inactive profile is denied before Drive token retrieval', async () => {
  for (const role of ['driver', 'admin']) {
    const { response, traces } = await invoke({
      role, profileStatus: 'Inativo', viewers: ['driver-1']
    });
    assert.equal(response.status, 403);
    assert.equal(traces.tokenConfigRead, 0);
    assert.equal(traces.networkCalls, 0);
  }
});

test('inactive driver is denied even when the profile and document grant are active', async () => {
  const { response, traces } = await invoke({
    driver: { id: 'driver-1', status: 'Inativo' }, viewers: ['driver-1']
  });
  assert.equal(response.status, 403);
  assert.equal(traces.tokenConfigRead, 0);
  assert.equal(traces.tables.includes('document_viewers'), false);
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

// A blank PDF page and two one-pixel images, generated for these tests.
const samples = {
  'application/pdf': 'JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgKHB5cGRmKQo+PgplbmRvYmoKMiAwIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDEKL0tpZHMgWyA0IDAgUiBdCj4+CmVuZG9iagozIDAgb2JqCjw8Ci9UeXBlIC9DYXRhbG9nCi9QYWdlcyAyIDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8Cj4+Ci9NZWRpYUJveCBbIDAuMCAwLjAgMzIgMzIgXQovUGFyZW50IDIgMCBSCj4+CmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTEzIDAwMDAwIG4gCjAwMDAwMDAxNjIgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSA1Ci9Sb290IDMgMCBSCi9JbmZvIDEgMCBSCj4+CnN0YXJ0eHJlZgoyNTQKJSVFT0YK',
  'image/jpeg': '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AP//Z',
  'image/png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR42mNoAAAAggCB2kUIOwAAAABJRU5ErkJggg==',
};

function readMedia(media, extra = {}) {
  return invoke({ viewers: ['driver-1'], media, ...extra });
}

for (const file of ['app.js', 'teste/app.js']) {
  test(file + ' receives the original PDF, JPEG and PNG via document-access', async () => {
    const app = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const [mime, encoded] of Object.entries(samples)) {
      const original = Buffer.from(encoded, 'base64');
      const ctx = vm.createContext({
        SUPABASE_URL: 'https://fixture.invalid', SUPABASE_PUBLISHABLE_KEY: 'fixture-public',
        visibleDocuments: () => [{ id: documentId }], currentUser: () => ({ role: 'driver' }),
        supabaseClient: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-session' } } }) } },
        fetch: async (url, options) => {
          assert.equal(url, 'https://fixture.invalid/functions/v1/document-access');
          const media = () => new Response(original, { headers: { 'content-type': mime } });
          const { response, traces } = await readMedia(media, { request: new Request(url, options) });
          assert.equal(traces.networkCalls, 2);
          assert.equal(response.headers.get('cache-control'), 'private, no-store');
          assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
          return response;
        },
      });
      vm.runInContext(app.slice(app.indexOf('async function fetchDocumentBlob('), app.indexOf('async function openDocument(')), ctx);
      const { data } = await ctx.fetchDocumentBlob(documentId);
      assert.equal(data.type, mime);
      assert.deepEqual(Buffer.from(await data.arrayBuffer()), original);
    }
  });
}

test('a partial or interrupted Drive transfer never becomes a downloadable document', async () => {
  const pdf = Buffer.from(samples['application/pdf'], 'base64');
  for (const media of [
    () => new Response(pdf.subarray(0, 20), { status: 206, headers: { 'content-type': 'application/pdf' } }),
    () => new Response(pdf.subarray(0, 20), { headers: { 'content-type': 'application/pdf', 'content-range': 'bytes 0-19/1000' } }),
    () => new Response(pdf.subarray(0, 20), { headers: { 'content-type': 'application/pdf', 'content-length': String(pdf.length) } }),
    () => { throw new Error('private fixture transport details'); },
    () => new Response('private fixture upstream details', { status: 404 }),
    () => new Response(new ReadableStream({ start(c) { c.error(new Error('private fixture transport details')); } })),
  ]) {
    const { response } = await readMedia(media);
    assert.equal(response.status, 502);
    assert.match(response.headers.get('content-type'), /json/);
    assert.doesNotMatch(await response.text(), /private fixture|%PDF/);
  }
});

test('transfer length checks allow decoded content and reject mismatched file signatures', async () => {
  const pdf = Buffer.from(samples['application/pdf'], 'base64');
  const decoded = await readMedia(() => new Response(pdf, { headers: {
    'content-type': 'application/pdf', 'content-encoding': 'gzip', 'content-length': '42',
  } }));
  assert.equal(decoded.response.status, 200);
  assert.deepEqual(Buffer.from(await decoded.response.arrayBuffer()), pdf);
  const mismatched = await readMedia(() => new Response(pdf, { headers: { 'content-type': 'image/png' } }));
  assert.equal(mismatched.response.status, 415);
});

test('the 12 MiB download limit accepts the boundary and cancels excess transfers', async () => {
  const limit = 12 * 1024 * 1024;
  const exact = new Uint8Array(limit);
  exact.set(Buffer.from(samples['application/pdf'], 'base64'));
  const atLimit = await readMedia(() => new Response(exact, { headers: { 'content-type': 'application/pdf' } }));
  assert.equal(atLimit.response.status, 200);
  assert.equal((await atLimit.response.arrayBuffer()).byteLength, limit);

  for (const declared of [true, false]) {
    let cancelled = false;
    const body = new ReadableStream({
      start(c) { if (!declared) { c.enqueue(exact); c.enqueue(Uint8Array.of(1)); } },
      cancel() { cancelled = true; },
    });
    const { response } = await readMedia(() => new Response(body, { headers: declared ? { 'content-length': String(limit + 1) } : {} }));
    assert.equal(response.status, 413);
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  }
});
