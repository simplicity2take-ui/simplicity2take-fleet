const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { pathToFileURL } = require('node:url');
const { webcrypto } = require('node:crypto');

const uploadPath = path.join(__dirname, '..', 'supabase/functions/drive-upload/index.ts');
const input = fs.readFileSync(uploadPath, 'utf8').replace(/^import .*;\r?\n/gm, '');
const tokenStart = input.indexOf('async function googleAccessToken(');
const tokenEnd = input.indexOf('async function driveRequest(', tokenStart);
assert(tokenStart > 0 && tokenEnd > tokenStart, 'Google authentication helper must be isolated');
const source = stripTypeScriptTypes(
  input.slice(0, tokenStart) +
  "async function googleAccessToken() { return 'test-only-token'; }\n" +
  input.slice(tokenEnd)
);

const root = 'RootFolder1234567890';
const top = 'MotoristasFolder123456789';
const target = 'DriverFolder1234567890';
const name = 'Ana Silva [00000000-0000-4000-8000-000000000001]';
const goodFolder = (id, n, parent) => ({
  id, name: n, mimeType: 'application/vnd.google-apps.folder', parents: [parent]
});
const defaultTop = goodFolder(top, 'Motoristas', root);
const defaultTarget = goodFolder(target, name, top);
const pdf = Buffer.from('%PDF-1.7\nfixture content').toString('base64');
const uploadId = 'a6f2fd31-d9ad-477a-9b90-3275be44fc34';
const recoveredFile = () => ({
  id: 'UploadedFile1234567890', name: 'seguro.pdf', mimeType: 'application/pdf',
  parents: [target], size: String(Buffer.from(pdf, 'base64').byteLength),
  appProperties: { s2tUploadId: uploadId }
});

async function run(options = {}) {
  const { readBoundedUploadJson, UploadRequestTooLargeError } = await import(
    pathToFileURL(path.join(__dirname, '..', 'supabase/functions/drive-upload/read-bounded-upload.mjs')).href
  );
  const events = { list: [], uploadLookups: [], folderCreates: [], fileUploads: [], logs: [] };
  const createClient = () => ({
    auth: { async getUser() { return { data: { user: { id: 'admin-user' } }, error: null }; } },
    from(table) {
      assert.equal(table, 'profiles');
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return { data: options.profile || { role: 'admin', status: 'Ativo' }, error: null };
        }
      };
    }
  });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    assert(u.hostname === 'www.googleapis.com', 'No real service requests are permitted');
    const isUpload = u.pathname.startsWith('/upload/drive/v3/files');
    const isFolder = u.pathname === '/drive/v3/files';
    if (isUpload && init.method === 'POST') {
      events.fileUploads.push({ url: String(url), size: init.body.byteLength });
      const data = options.uploadReturn || {
        id: 'UploadedFile1234567890', name: 'seguro.pdf', mimeType: 'application/pdf',
        parents: [target], size: String(Buffer.from(pdf, 'base64').byteLength),
        ...(options.uploadId ? { appProperties: { s2tUploadId: options.uploadId } } : {})
      };
      return new Response(JSON.stringify(data), { status: options.uploadStatus || 200 });
    }
    if (isFolder && init.method === 'POST') {
      const body = JSON.parse(init.body);
      events.folderCreates.push({ body, url: String(url) });
      const created = options.createdFolderOverride || goodFolder(
        body.name === 'Motoristas' ? top : target, body.name, body.parents[0]
      );
      return new Response(JSON.stringify(created), { status: 200 });
    }
    if (isFolder && (!init.method || init.method === 'GET')) {
      const q = u.searchParams.get('q') || '';
      if (q.includes("appProperties has")) {
        events.uploadLookups.push({ query: q, url: String(url) });
        return new Response(JSON.stringify(options.recoveredList || { files: [] }), { status: 200 });
      }
      const isTop = q.includes("name='Motoristas'");
      const configured = isTop ? options.topList : options.driverList;
      const created = events.folderCreates.find(item =>
        item.body.name === (isTop ? 'Motoristas' : name)
      );
      const afterCreate = isTop ? options.topListAfterCreate : options.driverListAfterCreate;
      const response = created
        ? (afterCreate ?? { files: [goodFolder(
            isTop ? top : target, created.body.name, created.body.parents[0]
          )] })
        : configured === undefined
          ? { files: [isTop ? defaultTop : defaultTarget] } : configured;
      events.list.push({ kind: isTop ? 'top' : 'driver', query: q, url: String(url) });
      return new Response(JSON.stringify(response), { status: 200 });
    }
    throw Error('Unexpected network destination: ' + u.pathname);
  };

  let handler;
  const sandbox = {
    createClient, readBoundedUploadJson, UploadRequestTooLargeError,
    fetch, Request, Response, Headers, URLSearchParams, URL,
    TextEncoder, TextDecoder, Uint8Array, crypto: webcrypto, atob, btoa,
    Deno: {
      env: { get(key) {
        if (key === 'GOOGLE_DRIVE_ROOT_FOLDER_ID') return root;
        if (key === 'GOOGLE_SERVICE_ACCOUNT_JSON') {
          return JSON.stringify({ client_email: 'fake@example.test', private_key: 'not-used' });
        }
        return 'test-only';
      } },
      serve(fn) { handler = fn; }
    },
    console: { error(message) { events.logs.push(message); } }
  };
  vm.runInNewContext(source, sandbox);
  const request = new Request('https://fake.example.test/upload', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({
      fileName: 'seguro.pdf', mimeType: 'application/pdf',
      folderType: 'drivers', folderName: name, base64: pdf,
      ...(options.uploadId !== undefined ? { uploadId: options.uploadId } : {}),
      ...(options.recoverOnly !== undefined ? { recoverOnly: options.recoverOnly } : {})
    })
  });
  const response = await handler(request);
  return { response, data: await response.json(), events };
}

test('full Edge Function: two verified folders permit only one file upload', async () => {
  const result = await run();
  assert.equal(result.response.status, 200);
  assert.equal(result.data.ok, true);
  assert.equal(result.data.fileId, 'UploadedFile1234567890');
  assert.equal(result.events.list.length, 2);
  assert.equal(result.events.folderCreates.length, 0);
  assert.equal(result.events.fileUploads.length, 1);
  assert.equal(result.data.webViewLink, undefined);
  assert(new URL(result.events.fileUploads[0].url).searchParams.get('ignoreDefaultVisibility') === 'true');
});

test('full Edge Function: duplicate top folders stop before file upload', async () => {
  const result = await run({ topList: {
    files: [defaultTop, goodFolder('DuplicateTopFolder12345', 'Motoristas', root)]
  } });
  assert.equal(result.response.status, 500);
  assert.equal(result.data.ok, false);
  assert.equal(result.events.list.length, 1);
  assert.equal(result.events.folderCreates.length, 0);
  assert.equal(result.events.fileUploads.length, 0);
  assert(!JSON.stringify(result.data).includes('DuplicateTopFolder12345'));
});

test('full Edge Function: duplicate driver folders stop before file upload', async () => {
  const result = await run({ driverList: {
    files: [defaultTarget, goodFolder('DuplicateDriverFolder12345', name, top)]
  } });
  assert.equal(result.response.status, 500);
  assert.equal(result.events.list.length, 2);
  assert.equal(result.events.fileUploads.length, 0);
  assert.equal(result.events.folderCreates.length, 0);
});

test('full Edge Function: incomplete or paginated folder responses stop without writing', async () => {
  for (const topList of [
    { files: [defaultTop], nextPageToken: 'more' },
    { files: [], incompleteSearch: true },
    { unexpected: [] }
  ]) {
    const result = await run({ topList });
    assert.equal(result.response.status, 500);
    assert.equal(result.events.fileUploads.length, 0);
    assert.equal(result.events.folderCreates.length, 0);
  }
});

test('full Edge Function: nonexistent folders can be created with private defaults', async () => {
  const result = await run({ topList: { files: [] }, driverList: { files: [] } });
  assert.equal(result.response.status, 200);
  assert.equal(result.events.folderCreates.length, 2);
  assert.equal(result.events.list.length, 4, 'Each new folder must be rechecked');
  assert.equal(result.events.fileUploads.length, 1);
  for (const creation of result.events.folderCreates) {
    assert.equal(new URL(creation.url).searchParams.get('ignoreDefaultVisibility'), 'true');
  }
  assert.deepEqual(result.events.folderCreates.map(x => x.body.parents[0]), [root, top]);
});

test('full Edge Function: duplicate folder discovered after create stops before upload', async () => {
  const result = await run({
    topList: { files: [] },
    topListAfterCreate: { files: [
      defaultTop, goodFolder('ParallelTopFolder12345678', 'Motoristas', root)
    ] }
  });
  assert.equal(result.response.status, 500);
  assert.equal(result.events.folderCreates.length, 1);
  assert.equal(result.events.list.length, 2, 'Created folder must be rechecked');
  assert.equal(result.events.fileUploads.length, 0);
});

test('full Edge Function: newly created folder absent on recheck cannot be used', async () => {
  const result = await run({
    topList: { files: [] },
    topListAfterCreate: { files: [] }
  });
  assert.equal(result.response.status, 500);
  assert.equal(result.events.list.length, 2);
  assert.equal(result.events.fileUploads.length, 0);
});

test('full Edge Function: driver folder collision after create stops before upload', async () => {
  const result = await run({
    driverList: { files: [] },
    driverListAfterCreate: { files: [
      defaultTarget, goodFolder('ParallelDriverFolder12345', name, top)
    ] }
  });
  assert.equal(result.response.status, 500);
  assert.equal(result.events.folderCreates.length, 1);
  assert.equal(result.events.fileUploads.length, 0);
});

test('full Edge Function: wrong folder parent on create stops before file upload', async () => {
  const result = await run({
    topList: { files: [] },
    createdFolderOverride: goodFolder(top, 'Motoristas', 'WrongParent123456789')
  });
  assert.equal(result.response.status, 500);
  assert.equal(result.events.folderCreates.length, 1);
  assert.equal(result.events.fileUploads.length, 0);
  assert(!JSON.stringify(result.data).includes('WrongParent123456789'));
});

test('full Edge Function: mismatched uploaded MIME is rejected without exposing raw Drive details', async () => {
  const result = await run({
    uploadReturn: { id: 'UploadedFile1234567890', name: 'seguro.pdf', mimeType: 'text/html' }
  });
  assert.equal(result.response.status, 502);
  assert.equal(result.data.ok, false);
  assert.equal(result.events.fileUploads.length, 1);
  assert(!JSON.stringify(result.data).includes('UploadedFile1234567890'));
});

test('full Edge Function: wrong destination folder is not accepted after upload', async () => {
  const result = await run({ uploadReturn: {
    id: 'UploadedFile1234567890', name: 'seguro.pdf', mimeType: 'application/pdf',
    parents: ['UnrelatedFolder1234567890'], size: String(Buffer.from(pdf, 'base64').byteLength)
  } });
  assert.equal(result.response.status, 502);
  assert.equal(result.data.ok, false);
  assert.equal(result.events.fileUploads.length, 1, 'Upload occurred, but was not confirmed');
  assert(!JSON.stringify(result.data).includes('UnrelatedFolder'));
});

test('full Edge Function: wrong byte size is not accepted after upload', async () => {
  const result = await run({ uploadReturn: {
    id: 'UploadedFile1234567890', name: 'seguro.pdf', mimeType: 'application/pdf',
    parents: [target], size: String(Buffer.from(pdf, 'base64').byteLength + 1)
  } });
  assert.equal(result.response.status, 502);
  assert.equal(result.data.ok, false);
  assert.equal(result.events.fileUploads.length, 1);
});

test('full Edge Function: missing returned parent or size is rejected', async () => {
  for (const uploadReturn of [
    { id: 'UploadedFile1234567890', name: 'seguro.pdf', mimeType: 'application/pdf', size: String(Buffer.from(pdf, 'base64').byteLength) },
    { id: 'UploadedFile1234567890', name: 'seguro.pdf', mimeType: 'application/pdf', parents: [target] }
  ]) {
    const result = await run({ uploadReturn });
    assert.equal(result.response.status, 502);
    assert.equal(result.data.ok, false);
    assert.equal(result.events.fileUploads.length, 1);
  }
});

test('full Edge Function: operation token is stored privately on the uploaded file', async () => {
  const result = await run({ uploadId });
  assert.equal(result.response.status, 200);
  assert.equal(result.events.uploadLookups.length, 1);
  assert.match(result.events.uploadLookups[0].query, /appProperties has/);
  assert.equal(result.events.fileUploads.length, 1);
  assert.equal(result.data.fileId, 'UploadedFile1234567890');
  const upload = await run({ uploadId });
  assert.equal(upload.events.fileUploads.length, 1);
});

test('full Edge Function: recovery locates a prior upload without creating a new file', async () => {
  const result = await run({ uploadId, recoverOnly: true, recoveredList: { files: [recoveredFile()] } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.ok, true);
  assert.equal(result.data.fileId, 'UploadedFile1234567890');
  assert.equal(result.events.uploadLookups.length, 1);
  assert.equal(result.events.fileUploads.length, 0);
  assert.equal(result.events.folderCreates.length, 0);
});

test('full Edge Function: missing prior upload stops with conflict, not reupload', async () => {
  const result = await run({ uploadId, recoverOnly: true });
  assert.equal(result.response.status, 409);
  assert.equal(result.data.ok, false);
  assert.equal(result.events.uploadLookups.length, 1);
  assert.equal(result.events.fileUploads.length, 0);
  assert.equal(result.events.folderCreates.length, 0);
});

test('full Edge Function: absent folder on retry never creates a replacement folder', async () => {
  const result = await run({ uploadId, recoverOnly: true, topList: { files: [] } });
  assert.equal(result.response.status, 409);
  assert.equal(result.events.fileUploads.length, 0);
  assert.equal(result.events.folderCreates.length, 0);
});

test('full Edge Function: stale or mismatched recovery markers fail closed', async () => {
  for (const recoveredList of [
    { files: [recoveredFile(), { ...recoveredFile(), id: 'SecondFile1234567890' }] },
    { files: [{ ...recoveredFile(), appProperties: { s2tUploadId: 'other' } }] },
    { files: [{ ...recoveredFile(), parents: ['AnotherFolder12345678'] }] },
    { files: [recoveredFile()], nextPageToken: 'more' },
    { files: [recoveredFile()], incompleteSearch: true }
  ]) {
    const result = await run({ uploadId, recoverOnly: true, recoveredList });
    assert.equal(result.response.status, 500);
    assert.equal(result.events.fileUploads.length, 0);
    assert.equal(result.events.folderCreates.length, 0);
  }
});

test('full Edge Function: malformed recovery tokens are rejected before Drive access', async () => {
  for (const options of [
    { uploadId: 'not-a-uuid' },
    { recoverOnly: true },
    { uploadId, recoverOnly: 'yes' }
  ]) {
    const result = await run(options);
    assert.equal(result.response.status, 400);
    assert.equal(result.events.list.length, 0);
    assert.equal(result.events.fileUploads.length, 0);
  }
});

test('full Edge Function: inactive admin stops before any Google request', async () => {
  const result = await run({ profile: { role: 'admin', status: 'Inativo' } });
  assert.equal(result.response.status, 403);
  assert.equal(result.events.list.length, 0);
  assert.equal(result.events.fileUploads.length, 0);
  assert.equal(result.events.folderCreates.length, 0);
});
