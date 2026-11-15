const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const source = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/drive-upload/index.ts'), 'utf8');
const start = source.indexOf('function validDriveFolder(');
const end = source.indexOf('function decodeBase64(', start);
assert(start >= 0 && end > start, 'Folder lookup helpers must be available');
const sourceSlice = stripTypeScriptTypes(source.slice(start, end));

const parentId = 'ParentFolder1234567890';
const fileId = 'ExistingFolder1234567890';
const folderName = "António O'Brien";
const folder = (overrides = {}) => ({
  id: fileId, name: folderName,
  mimeType: 'application/vnd.google-apps.folder',
  parents: [parentId], ...overrides
});

function setup(listResponse, createdResponse, afterCreateResponse) {
  const calls = [];
  let created = false;
  const context = {
    URLSearchParams,
    driveRequest: async (token, url, init = {}) => {
      calls.push({ token, url, init });
      if (init.method === 'POST') created = true;
      return { json: async () => init.method === 'POST'
        ? createdResponse
        : created ? (afterCreateResponse ?? { files: [createdResponse] }) : listResponse };
    }
  };
  vm.createContext(context);
  vm.runInContext(sourceSlice, context);
  return { context, calls };
}

test('reuses exactly one matching Drive folder with no writes', async () => {
  const h = setup({ files: [folder()] });
  assert.equal(await h.context.ensureFolder('token', folderName, parentId), fileId);
  assert.equal(h.calls.length, 1);
  const url = new URL(h.calls[0].url);
  assert.equal(url.searchParams.get('pageSize'), '2');
  assert.equal(url.searchParams.get('fields'), 'nextPageToken,incompleteSearch,files(id,name,mimeType,parents)');
  assert(url.searchParams.get('q').includes("name='António O\\'Brien'"));
  assert.equal(h.calls[0].init.method, undefined);
});

test('creates a folder when lookup confirms no matches', async () => {
  const h = setup({ files: [] }, folder());
  assert.equal(await h.context.ensureFolder('token', folderName, parentId), fileId);
  assert.equal(h.calls.length, 3, 'Created folders must be re-listed after POST');
  assert.equal(h.calls[2].init.method, undefined);
  const url = new URL(h.calls[1].url);
  assert.equal(url.searchParams.get('ignoreDefaultVisibility'), 'true');
  assert.equal(url.searchParams.get('fields'), 'id,name,mimeType,parents');
  const metadata = JSON.parse(h.calls[1].init.body);
  assert.equal(metadata.name, folderName);
  assert.equal(metadata.parents[0], parentId);
});

for (const [label, response] of [
  ['duplicate matching folders', { files: [folder(), folder({ id: 'AnotherFolder123456789' })] }],
  ['unread matching folders on a second page', { files: [folder()], nextPageToken: 'next-page' }],
  ['partial empty page', { files: [], nextPageToken: 'next-page' }],
  ['incomplete Drive search', { files: [folder()], incompleteSearch: true }],
  ['invalid Drive response', { items: [folder()] }],
  ['wrong folder name', { files: [folder({ name: 'Someone Else' })] }],
  ['incorrect parent', { files: [folder({ parents: ['OtherParent123456789'] })] }],
  ['missing folder parent', { files: [folder({ parents: [] })] }],
  ['short invalid folder identifier', { files: [folder({ id: 'abc' })] }],
  ['wrong mime type', { files: [folder({ mimeType: 'text/plain' })] }]
]) {
  test('fails closed for ' + label, async () => {
    const h = setup(response);
    await assert.rejects(h.context.ensureFolder('token', folderName, parentId), /ambiguous or invalid/);
    assert.equal(h.calls.length, 1, 'No folder should be created after an uncertain lookup');
  });
}

for (const [label, data] of [
  ['missing ID', { ...folder(), id: null }],
  ['wrong parent', folder({ parents: ['WrongParent123456789'] })],
  ['wrong name', folder({ name: 'Wrong Folder' })],
  ['wrong MIME', folder({ mimeType: 'text/plain' })]
]) {
  test('rejects unverified created folder metadata: ' + label, async () => {
    const h = setup({ files: [] }, data);
    await assert.rejects(h.context.ensureFolder('token', folderName, parentId), /requested parent folder/);
    assert.equal(h.calls.length, 2);
  });
}

test('duplicate folders appearing during creation are rejected before use', async () => {
  const concurrent = folder({ id: 'OtherCreatedFolder123456789' });
  const h = setup({ files: [] }, folder(), { files: [folder(), concurrent] });
  await assert.rejects(
    h.context.ensureFolder('token', folderName, parentId), /ambiguous or invalid/
  );
  assert.equal(h.calls.length, 3, 'Two reads surround one folder create');
  assert.equal(h.calls.filter(call => call.init.method === 'POST').length, 1);
});

test('new folder not yet visible in listing is not trusted', async () => {
  const h = setup({ files: [] }, folder(), { files: [] });
  await assert.rejects(h.context.ensureFolder('token', folderName, parentId), /could not be verified/);
  assert.equal(h.calls.length, 3);
});

test('new folder replaced with a different folder in subsequent search is rejected', async () => {
  const h = setup({ files: [] }, folder(), {
    files: [folder({ id: 'DifferentFolder123456789' })]
  });
  await assert.rejects(h.context.ensureFolder('token', folderName, parentId), /could not be verified/);
  assert.equal(h.calls.length, 3);
});

test('new folder search with unfinished pagination is rejected', async () => {
  const h = setup({ files: [] }, folder(), { files: [folder()], nextPageToken: 'more' });
  await assert.rejects(h.context.ensureFolder('token', folderName, parentId), /ambiguous or invalid/);
  assert.equal(h.calls.length, 3);
});

test('escapes path identifiers in Google Drive search queries', async () => {
  const parentWithQuote = "Root'\\Parent123456789";
  const h = setup({ files: [] }, folder({ parents: [parentWithQuote] }));
  await h.context.ensureFolder('token', folderName, parentWithQuote);
  const q = new URL(h.calls[0].url).searchParams.get('q');
  assert(q.includes("name='António O\\'Brien'"));
  assert(q.includes("Root\\'\\\\Parent123456789"));
});
