const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { pathToFileURL } = require('node:url');

const source = stripTypeScriptTypes(fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/drive-upload/index.ts'), 'utf8'
).replace(/^import .*;\r?\n/gm, ''));

async function callUpload(profile, { user = { id: 'admin-profile' }, body = {} } = {}) {
  let handler;
  let profileReads = 0;
  const { readBoundedUploadJson, UploadRequestTooLargeError } = await import(
    pathToFileURL(path.join(__dirname, '..', 'supabase/functions/drive-upload/read-bounded-upload.mjs')).href
  );
  const createClient = () => ({
    auth: { async getUser() { return { data: { user } }; } },
    from(table) {
      assert.equal(table, 'profiles');
      return {
        select(columns) {
          assert.equal(columns, 'role,status');
          return this;
        },
        eq(column, id) {
          assert.equal(column, 'id');
          assert.equal(id, user.id);
          return this;
        },
        async maybeSingle() {
          profileReads++;
          return { data: profile, error: null };
        }
      };
    }
  });
  vm.runInNewContext(source, {
    createClient, readBoundedUploadJson, UploadRequestTooLargeError,
    Request, Response, Headers, TextEncoder, TextDecoder, URLSearchParams,
    Deno: { env: { get: () => 'test-only' }, serve: callback => { handler = callback; } },
    console: { error() {} },
  });
  assert.equal(typeof handler, 'function');
  const response = await handler(new Request('https://fixture.example.test/drive-upload', {
    method: 'POST',
    headers: { authorization: 'Bearer fixture-user', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }));
  return { response, profileReads };
}

test('active admin reaches document validation', async () => {
  const { response, profileReads } = await callUpload({ role: 'admin', status: 'Ativo' });
  assert.equal(response.status, 400);
  assert.equal(profileReads, 1);
  const result = await response.json();
  assert.match(result.error, /Ficheiro em falta/);
});

test('inactive admin cannot upload documents with an otherwise valid session', async () => {
  const { response, profileReads } = await callUpload({ role: 'admin', status: 'Inativo' });
  assert.equal(response.status, 403);
  assert.equal(profileReads, 1);
});

test('unknown profile, unknown status, or non-admin role cannot upload', async () => {
  for (const profile of [null, { role: 'driver', status: 'Ativo' }, { role: 'admin', status: null }]) {
    const { response } = await callUpload(profile);
    assert.equal(response.status, 403);
  }
});
