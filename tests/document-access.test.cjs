const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
(async () => {
  for (const path of ['app.js', 'teste/app.js']) {
    const source = fs.readFileSync(require('node:path').join(__dirname, '..', path), 'utf8');
    let role = 'driver', token = 'test-session', status = 200, calls = 0, authorized = true;
    let authUser = 'account-a';
    const bytes = Uint8Array.from([255, 216, 255, 0, 128, 254, 217]);
    const context = {
      SUPABASE_URL: 'https://example.invalid', SUPABASE_PUBLISHABLE_KEY: 'test-public',
      documentBlobCache: new Map(), visibleDocuments: () => authorized ? [{ id: 'doc' }] : [],
      currentUser: () => ({ id: 'account-a', role }), supabaseClient: { auth: { getSession: async () => ({ data: { session: token ? { user: { id: authUser }, access_token: token } : null } }) } },
      fetch: async (url, options) => {
        calls++;
        assert.equal(options.headers.Authorization, 'Bearer test-session');
        assert.equal(options.headers.apikey, 'test-public');
        assert.equal(options.cache, 'no-store');
        assert.equal(JSON.parse(options.body).document_id, 'doc');
        return status === 200 ? new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }) : new Response(JSON.stringify({ error: 'Sem autorização.' }), { status });
      }
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('async function fetchDocumentBlob('), source.indexOf('\nasync function openDocument(')), context);
    const first = await context.fetchDocumentBlob('doc');
    assert.equal(first.data.type, 'image/jpeg');
    assert.deepEqual(new Uint8Array(await first.data.arrayBuffer()), bytes);
    await context.fetchDocumentBlob('doc');
    assert.equal(calls, 2); // Each driver opening revalidates server access.
    role = 'admin';
    await context.fetchDocumentBlob('doc'); await context.fetchDocumentBlob('doc');
    assert.equal(calls, 3);
    authUser = 'account-b';
    await assert.rejects(context.fetchDocumentBlob('doc'), /Sessão terminada/);
    authUser = 'account-a';
    token = null;
    await assert.rejects(context.fetchDocumentBlob('doc'), /Sessão terminada/);
    assert.equal(calls, 3);
    token = 'test-session';
    context.documentBlobCache.clear(); status = 403;
    await assert.rejects(context.fetchDocumentBlob('doc'), /Sem autorização/);
    assert.equal(context.documentBlobCache.size, 0);
    token = null;
    await assert.rejects(context.fetchDocumentBlob('doc'), /Sessão terminada/);
    assert.equal(calls, 4);
    authorized = false;
    await assert.rejects(context.fetchDocumentBlob('doc'), /sem autorização/);
    assert.equal(calls, 4);
    // Clear the session while an admin fetch is pending and re-enter as the same user.
    // The old response must not populate the newly opened session's cache.
    authorized = true; token = 'test-session';
    let release, started;
    const requested = new Promise(resolve => { started = resolve; });
    context.fetch = () => new Promise(resolve => { release = resolve; started(); });
    context.document = { querySelector: () => null };
    context.closeDocumentPreview = null;
    vm.runInContext(source.slice(source.indexOf('function resetDocumentSession('), source.indexOf('async function fetchDocumentBlob(')), context);
    const pending = context.fetchDocumentBlob('doc');
    await requested;
    context.resetDocumentSession();
    release(new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }));
    await assert.rejects(pending, /sessão mudou/i);
    assert.equal(context.documentBlobCache.size, 0);
    console.log(path + ': PASS JPEG bytes preserved, session used, driver revalidation, admin cache, denial and missing-session handling.');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
