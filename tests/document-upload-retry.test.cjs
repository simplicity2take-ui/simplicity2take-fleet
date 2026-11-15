const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(portalPath, failurePoint) {
  const code = fs.readFileSync(path.join(__dirname, '..', portalPath), 'utf8');
  const start = code.indexOf('function matchesPendingDocumentUpload(');
  const end = code.indexOf('function fileToBase64(', start);
  assert(start >= 0 && end > start, 'Retry logic must remain available in the portal');
  const file = { name: 'insurance.pdf', type: 'application/pdf', size: 120 };
  const events = { uploads: 0, inserts: 0, updates: 0, viewerInserts: 0 };
  const state = {
    documentContext: 'company', documents: [], vehicles: [], drivers: [],
    sessionUserId: 'admin', activeView: 'documents'
  };
  const db = {
    from(table) {
      if (table === 'documents') return {
        insert() {
          events.inserts++;
          return { select: () => ({ single: async () => ({
            data: { id: 'doc-created-1' },
            error: failurePoint === 'document' && events.inserts === 1 ? new Error('database unavailable') : null,
          }) }) };
        },
        update() {
          events.updates++;
          return { eq: () => ({ select: () => ({ single: async () => ({
            data: { id: 'doc-created-1' }, error: null
          }) }) }) };
        }
      };
      if (table === 'document_viewers') return {
        select() { return { eq: async () => ({ data: [], error: null }) }; },
        delete() { return { eq: () => ({ in: async () => ({ error: null }) }) }; },
        upsert() {
          events.viewerInserts++;
          return Promise.resolve({
            error: failurePoint === 'viewer' && events.viewerInserts === 1
              ? new Error('viewer insert failed') : null
          });
        }
      };
      throw new Error('Unexpected table: ' + table);
    },
    functions: {
      async invoke() {
        events.uploads++;
        return { data: {
          ok: true, fileId: 'validdriveid1234', fileName: file.name,
          mimeType: file.type, webViewLink: ''
        }, error: null };
      }
    }
  };
  const sandbox = {
    state, supabaseClient: db, documentBlobCache: new Map(), showToast() {},
    validateDocumentFile() {}, fileToBase64: async () => 'JVBERi0=',
    selectors: { modalFields: { querySelector() { return { files: [file] }; } } }
  };
  vm.createContext(sandbox);
  vm.runInContext(code.slice(start, end) + `
    globalThis.testApi = {
      saveDocument, matchesPendingDocumentUpload,
      pending: () => state.pendingDocumentUpload
    };
  `, sandbox, { timeout: 1000 });
  const values = { name: 'Seguro', type: 'Carta Verde', expiryDate: '2027-01-01' };
  return { ...sandbox.testApi, values, file, events };
}

for (const portalPath of ['app.js', 'teste/app.js']) {
  test(portalPath + ': retry after database insert error reuses Drive file', async () => {
    const h = harness(portalPath, 'document');
    await assert.rejects(h.saveDocument(h.values, [], ''), /database unavailable/);
    await h.saveDocument(h.values, [], '');
    assert.equal(h.events.uploads, 1);
    assert.equal(h.events.inserts, 2);
    assert.equal(h.events.updates, 0);
    assert.equal(h.pending(), null);
  });

  test(portalPath + ': retry after viewer failure updates existing row', async () => {
    const h = harness(portalPath, 'viewer');
    await assert.rejects(h.saveDocument(h.values, ['driver-1'], ''), /viewer insert failed/);
    await h.saveDocument(h.values, ['driver-1'], '');
    assert.equal(h.events.uploads, 1);
    assert.equal(h.events.inserts, 1);
    assert.equal(h.events.updates, 1);
    assert.equal(h.events.viewerInserts, 2);
    assert.equal(h.pending(), null);
  });

  test(portalPath + ': changed file or destination cannot reuse an upload receipt', () => {
    const h = harness(portalPath);
    const pending = {
      editingId: '', file: h.file, context: 'company',
      vehicleId: null, driverId: null, driveData: { fileId: 'a' }
    };
    assert.equal(h.matchesPendingDocumentUpload(pending, h.file, 'company', null, null, ''), true);
    assert.equal(h.matchesPendingDocumentUpload(pending, { ...h.file }, 'company', null, null, ''), false);
    assert.equal(h.matchesPendingDocumentUpload(pending, h.file, 'vehicle', null, null, ''), false);
    assert.equal(h.matchesPendingDocumentUpload(pending, h.file, 'company', null, null, 'other'), false);
  });
}
