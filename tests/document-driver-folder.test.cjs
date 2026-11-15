const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(portalPath) {
  const source = fs.readFileSync(path.join(__dirname, '..', portalPath), 'utf8');
  const start = source.indexOf('function driveDriverFolderName(');
  const end = source.indexOf('function fileToBase64(', start);
  assert(start >= 0 && end > start, 'Driver folder name and saveDocument must be available');

  const file = { name: 'carta.pdf', type: 'application/pdf', size: 48 };
  const drivers = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'António Oliveira' },
    { id: '22222222-2222-4222-8222-222222222222', name: 'António Oliveira' },
  ];
  const uploads = [];
  const saves = [];
  const state = {
    documents: [], vehicles: [], drivers,
    documentContext: 'driver', sessionUserId: 'admin'
  };
  const supabaseClient = {
    functions: { async invoke(name, { body }) {
      assert.equal(name, 'drive-upload');
      uploads.push(body);
      return { data: {
        ok: true, fileId: 'drive-file-' + uploads.length,
        fileName: file.name, mimeType: file.type, webViewLink: ''
      }, error: null };
    } },
    from(table) {
      if (table === 'documents') return {
        insert(payload) {
          saves.push(payload);
          return { select: () => ({ single: async () => ({
            data: { id: 'document-' + saves.length }, error: null
          }) }) };
        }
      };
      if (table === 'document_viewers') return {
        select() {
          return { eq: async () => ({ data: [], error: null }) };
        }
      };
      throw new Error('Unexpected table: ' + table);
    }
  };
  const env = {
    state, supabaseClient, documentBlobCache: new Map(), showToast() {},
    // New uploads create a stable operation ID before contacting Drive.
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    validateDocumentFile() {}, fileToBase64: async () => 'JVBERi0=',
    selectors: { modalFields: { querySelector: () => ({ files: [file] }) } }
  };
  vm.createContext(env);
  vm.runInContext(source.slice(start, end), env);
  return { env, drivers, uploads, saves };
}

for (const portalPath of ['app.js', 'teste/app.js']) {
  test(portalPath + ': identical driver names use different Drive folders', async () => {
    const h = harness(portalPath);
    for (const driver of h.drivers) {
      await h.env.saveDocument({ name: 'Carta', type: 'Carta de Condução', driverId: driver.id }, [], '');
    }
    assert.equal(h.uploads.length, 2);
    assert.equal(h.uploads[0].folderType, 'drivers');
    assert.equal(h.uploads[1].folderType, 'drivers');
    assert.notEqual(h.uploads[0].folderName, h.uploads[1].folderName);
    assert.equal(h.uploads[0].folderName, 'António Oliveira [' + h.drivers[0].id + ']');
    assert.equal(h.uploads[1].folderName, 'António Oliveira [' + h.drivers[1].id + ']');
    assert.deepEqual(h.saves.map(row => row.driver_id), h.drivers.map(d => d.id));
  });

  test(portalPath + ': folder names strip path separators and stay within limits', () => {
    const h = harness(portalPath);
    const longName = '  Ana/\\Com\nOutro Nome  ' + 'A'.repeat(250);
    const folderName = h.env.driveDriverFolderName({ name: longName }, h.drivers[0].id);
    assert(!folderName.includes('/') && !folderName.includes('\\') && !folderName.includes('\n'));
    assert(folderName.endsWith('[' + h.drivers[0].id + ']'));
    assert(folderName.length <= 180);
    assert.equal(h.env.driveDriverFolderName({ name: '' }, h.drivers[0].id),
      'Motorista [' + h.drivers[0].id + ']');
  });
}
