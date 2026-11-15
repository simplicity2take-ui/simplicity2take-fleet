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
  let selectedFile = file;
  const events = { uploads: 0, inserts: 0, updates: 0, viewerInserts: 0, recoveries: 0, insertedPayload: null, updatedPayload: null };
  let committed = false;
  const state = {
    documentContext: 'company', documents: [], vehicles: [], drivers: [],
    sessionUserId: 'admin', activeView: 'documents'
  };
  const db = {
    from(table) {
      if (table === 'documents') return {
        insert(payload) {
          events.insertedPayload = payload;
          events.inserts++;
          return { select: () => ({ single: async () => {
            if (events.inserts === 1 && failurePoint === 'response-lost') {
              committed = true;
              return { data: null, error: new Error('database response lost') };
            }
            if (events.inserts === 1 && ['document', 'lookup'].includes(failurePoint)) {
              return { data: null, error: new Error('database unavailable') };
            }
            committed = true;
            return { data: { id: 'doc-created-1' }, error: null };
          } }) };
        },
        select() {
          return { eq: (field, value) => {
            assert.equal(field, 'drive_file_id');
            assert.equal(value, 'validdriveid1234');
            return { maybeSingle: async () => {
              events.recoveries++;
              if (failurePoint === 'lookup') {
                return { data: null, error: new Error('database recovery unavailable') };
              }
              return { data: committed ? { id: 'doc-created-1' } : null, error: null };
            } };
          } };
        },
        update(payload) {
          events.updatedPayload = payload;
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
      async invoke(_functionName, { body }) {
        events.uploads++;
        return { data: {
          ok: true, fileId: events.uploads === 1 ? 'validdriveid1234' : 'validdriveid5678',
          fileName: body.fileName, mimeType: body.mimeType,
          webViewLink: 'https://drive.google.com/file/d/private-placeholder/view'
        }, error: null };
      }
    }
  };
  const sandbox = {
    state, supabaseClient: db, documentBlobCache: new Map(), showToast() {},
    validateDocumentFile() {}, fileToBase64: async () => 'JVBERi0=',
    selectors: { modalFields: { querySelector() { return { files: [selectedFile] }; } } }
  };
  vm.createContext(sandbox);
  vm.runInContext(code.slice(start, end) + `
    globalThis.testApi = {
      saveDocument, matchesPendingDocumentUpload,
      pending: () => state.pendingDocumentUpload
    };
  `, sandbox, { timeout: 1000 });
  const values = { name: 'Seguro', type: 'Carta Verde', expiryDate: '2027-01-01' };
  return { ...sandbox.testApi, values, file, events, state, setFile: nextFile => { selectedFile = nextFile; } };
}

for (const portalPath of ['app.js', 'teste/app.js']) {
  test(portalPath + ': new Drive uploads do not store a direct view URL', async () => {
    const h = harness(portalPath);
    await h.saveDocument(h.values, [], '');
    assert.equal(h.events.inserts, 1);
    assert.equal(h.events.insertedPayload.drive_web_view_link, null);
    assert.equal(h.events.insertedPayload.drive_file_id, 'validdriveid1234');
  });

  test(portalPath + ': replacing a document clears the legacy direct URL', async () => {
    const h = harness(portalPath);
    h.setFile({ name: 'replacement.pdf', type: 'application/pdf', size: 140 });
    // The existing document keeps its metadata when no file is selected,
    // but a replacement must never persist its old external link.
    await h.saveDocument(h.values, [], 'existing-document-1');
    assert.equal(h.events.updates, 1);
    assert.equal(h.events.updatedPayload.drive_web_view_link, null);
  });

  test(portalPath + ': metadata-only edit retains legacy URL without creating a new Drive file', async () => {
    const h = harness(portalPath);
    const existing = {
      id: 'existing-document-1', name: 'Seguro', driveFileId: 'existingDriveFile12345',
      driveUrl: 'https://drive.google.com/file/d/legacy/view',
      fileName: 'legacy.pdf', fileType: 'application/pdf'
    };
    h.state.documents.push(existing);
    h.setFile(null);
    await h.saveDocument(h.values, [], existing.id);
    assert.equal(h.events.uploads, 0);
    assert.equal(h.events.updates, 1);
    assert.equal(h.events.updatedPayload.drive_web_view_link, existing.driveUrl);
    assert.equal(h.events.updatedPayload.drive_file_id, existing.driveFileId);
  });

  test(portalPath + ': retry after database insert error reuses Drive file', async () => {
    const h = harness(portalPath, 'document');
    await assert.rejects(h.saveDocument(h.values, [], ''), /database unavailable/);
    await h.saveDocument(h.values, [], '');
    assert.equal(h.events.uploads, 1);
    assert.equal(h.events.inserts, 2);
    assert.equal(h.events.updates, 0);
    assert.equal(h.pending(), null);
  });

  test(portalPath + ': recovers committed document when insert response was lost', async () => {
    const h = harness(portalPath, 'response-lost');
    await assert.rejects(h.saveDocument(h.values, [], ''), /database response lost/);
    await h.saveDocument(h.values, [], '');
    assert.equal(h.events.uploads, 1);
    assert.equal(h.events.recoveries, 1);
    assert.equal(h.events.inserts, 1);
    assert.equal(h.events.updates, 1);
    assert.equal(h.pending(), null);
  });

  test(portalPath + ': failed recovery lookup stops before duplicate insert', async () => {
    const h = harness(portalPath, 'lookup');
    await assert.rejects(h.saveDocument(h.values, [], ''), /database unavailable/);
    await assert.rejects(h.saveDocument(h.values, [], ''), /Não foi possível confirmar/);
    assert.equal(h.events.uploads, 1);
    assert.equal(h.events.recoveries, 1);
    assert.equal(h.events.inserts, 1);
    assert.equal(h.events.updates, 0);
    assert.notEqual(h.pending(), null);
  });

  test(portalPath + ': switching file after lost SQL response reuses committed document', async () => {
    const h = harness(portalPath, 'response-lost');
    await assert.rejects(h.saveDocument(h.values, [], ''), /database response lost/);
    h.setFile({ name: 'replacement.pdf', type: 'application/pdf', size: 140 });
    await h.saveDocument(h.values, [], '');
    assert.equal(h.events.recoveries, 1, 'Original Drive reference must be reconciled first');
    assert.equal(h.events.uploads, 2, 'The replacement file must be uploaded once');
    assert.equal(h.events.inserts, 1, 'A second database row must not be inserted');
    assert.equal(h.events.updates, 1, 'Update the recovered document');
    assert.equal(h.pending(), null);
  });

  test(portalPath + ': changing file cannot bypass failed recovery lookup', async () => {
    const h = harness(portalPath, 'lookup');
    await assert.rejects(h.saveDocument(h.values, [], ''), /database unavailable/);
    h.setFile({ name: 'replacement.pdf', type: 'application/pdf', size: 140 });
    await assert.rejects(h.saveDocument(h.values, [], ''), /Não foi possível confirmar/);
    assert.equal(h.events.recoveries, 1);
    assert.equal(h.events.uploads, 1, 'Do not send the second file while first write is unknown');
    assert.equal(h.events.inserts, 1);
    assert.equal(h.events.updates, 0);
  });

  test(portalPath + ': switching file after rejected insert can safely create fresh row', async () => {
    const h = harness(portalPath, 'document');
    await assert.rejects(h.saveDocument(h.values, [], ''), /database unavailable/);
    h.setFile({ name: 'replacement.pdf', type: 'application/pdf', size: 140 });
    await h.saveDocument(h.values, [], '');
    assert.equal(h.events.recoveries, 1);
    assert.equal(h.events.uploads, 2);
    assert.equal(h.events.inserts, 2);
    assert.equal(h.events.updates, 0);
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
      vehicleId: null, driverId: null, folderName: '', driveData: { fileId: 'a' }
    };
    assert.equal(h.matchesPendingDocumentUpload(pending, h.file, 'company', null, null, '', ''), true);
    assert.equal(h.matchesPendingDocumentUpload(pending, { ...h.file }, 'company', null, null, '', ''), false);
    assert.equal(h.matchesPendingDocumentUpload(pending, h.file, 'vehicle', null, null, '', ''), false);
    assert.equal(h.matchesPendingDocumentUpload(pending, h.file, 'company', null, null, 'other', ''), false);
    assert.equal(h.matchesPendingDocumentUpload(pending, h.file, 'company', null, null, '', 'renamed'), false);
  });
}
