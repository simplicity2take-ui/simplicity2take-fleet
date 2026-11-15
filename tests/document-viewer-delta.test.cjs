const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeHarness(portal, initialViewers, options = {}) {
  const code = fs.readFileSync(path.join(__dirname, '..', portal), 'utf8');
  const start = code.indexOf('function matchesPendingDocumentUpload(');
  const end = code.indexOf('function fileToBase64(', start);
  assert(start >= 0 && end > start, 'Document editing and permissions code must be available');
  const saved = new Map(initialViewers.map(item => [item.driver_id, item.can_view]));
  const events = { reads: 0, revoked: [], granted: [], documentUpdates: 0 };
  const doc = {
    id: 'document-1', name: 'Seguro', type: 'Carta Verde',
    driveFileId: 'drivefile12345', fileName: 'seguro.pdf', fileType: 'application/pdf'
  };
  const state = {
    documents: [doc], documentContext: options.context || 'company',
    vehicles: [], drivers: options.context === 'driver' ? [{ id: 'driver-owner' }] : [], sessionUserId: 'administrator', activeView: 'documents'
  };
  const db = {
    from(table) {
      if (table === 'documents') return {
        update() {
          events.documentUpdates++;
          return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: doc.id }, error: null }) }) }) };
        }
      };
      if (table !== 'document_viewers') throw Error('Unexpected table: ' + table);
      return {
        select() { return { eq: async () => {
          events.reads++;
          return options.readFailure
            ? { data: null, error: Error('viewer read unavailable') }
            : { data: [...saved].map(([driver_id, can_view]) => ({ driver_id, can_view })), error: null };
        } }; },
        delete() { return { eq: () => ({ in: async (_, ids) => {
          events.revoked.push(...ids);
          for (const id of ids) saved.delete(id);
          return { error: null };
        } }) }; },
        upsert: async (rows, opts) => {
          assert.equal(opts.onConflict, 'document_id,driver_id');
          events.granted.push(...rows.map(row => row.driver_id));
          if (options.grantFailure) return { error: Error('viewer grant unavailable') };
          for (const row of rows) saved.set(row.driver_id, row.can_view);
          return { error: null };
        }
      };
    }
  };
  const sandbox = {
    state, supabaseClient: db, documentBlobCache: new Map(),
    selectors: { modalFields: { querySelector: () => ({ files: [] }) } },
    validateDocumentFile() {}, showToast() {}
  };
  vm.createContext(sandbox);
  vm.runInContext(code.slice(start, end), sandbox);
  const save = selected => sandbox.saveDocument({ name: 'Seguro', type: 'Carta Verde', driverId: options.context === 'driver' ? 'driver-owner' : undefined }, selected, doc.id);
  return { save, saved, events };
}

for (const portal of ['app.js', 'teste/app.js']) {
  test(portal + ': unchanged authorizations stay intact', async () => {
    const h = makeHarness(portal, [{ driver_id: 'a', can_view: true }]);
    await h.save(['a']);
    assert.equal(h.events.reads, 1);
    assert.deepEqual(h.events.revoked, []);
    assert.deepEqual(h.events.granted, []);
    assert.equal(h.saved.get('a'), true);
  });

  test(portal + ': grant and revoke only changed permissions', async () => {
    const h = makeHarness(portal, [
      { driver_id: 'a', can_view: true }, { driver_id: 'b', can_view: true },
      { driver_id: 'c', can_view: false }
    ]);
    await h.save(['a', 'c', 'd']);
    assert.deepEqual(h.events.revoked, ['b']);
    assert.deepEqual(h.events.granted, ['c', 'd']);
    assert.deepEqual([...h.saved].sort(), [['a', true], ['c', true], ['d', true]]);
  });

  test(portal + ': failed grant preserves unchanged existing permissions', async () => {
    const h = makeHarness(portal, [{ driver_id: 'a', can_view: true }], { grantFailure: true });
    await assert.rejects(h.save(['a', 'b']), /viewer grant unavailable/);
    assert.deepEqual(h.events.revoked, []);
    assert.deepEqual(h.events.granted, ['b']);
    assert.equal(h.saved.get('a'), true);
    assert.equal(h.saved.has('b'), false);
  });

  test(portal + ': failed permission read cannot delete authorizations', async () => {
    const h = makeHarness(portal, [{ driver_id: 'a', can_view: true }], { readFailure: true });
    await assert.rejects(h.save([]), /viewer read unavailable/);
    assert.deepEqual(h.events.revoked, []);
    assert.deepEqual(h.events.granted, []);
    assert.equal(h.saved.get('a'), true);
  });

  test(portal + ': personal documents do not inherit explicit grants', async () => {
    const h = makeHarness(portal, [{ driver_id: 'a', can_view: true }], { context: 'driver' });
    await h.save(['a']);
    assert.equal(h.saved.has('a'), false);
    assert.deepEqual(h.events.revoked, ['a']);
    assert.deepEqual(h.events.granted, []);
  });
}
