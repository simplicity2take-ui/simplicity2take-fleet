const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/document-access/index.ts'), 'utf8');
const start = source.indexOf('    const parts = new Intl.DateTimeFormat(');
const end = source.indexOf('    const appsScriptUrl = ', start);
assert.ok(start !== -1 && end > start, 'expiry guard must exist in edge function');
const guard = source.slice(start, end)
  .replace('const datePart = (type: string)', 'const datePart = (type)');

async function check(expiry, admin, date) {
  let rpcCalls = 0;
  const context = {
    Intl, Date: class extends Date { constructor(...args) { super(...(args.length ? args : [date])); } },
    document: { expiry_date: expiry },
    supabase: { rpc: async name => { assert.equal(name, 's2t_is_admin'); rpcCalls++; return { data: admin, error: null }; } },
    json: (body, status) => ({ body, status })
  };
  const fn = vm.runInNewContext('(async () => { ' + guard + ' return { status: 200 }; })', context);
  const result = await fn();
  return JSON.parse(JSON.stringify({ status: result.status, rpcCalls }));
}

test('driver is denied expired document bytes', async () => {
  assert.deepEqual(await check('2026-11-12', false, '2026-11-13T22:00:00Z'), { status: 403, rpcCalls: 1 });
});
test('administrator can inspect expired document', async () => {
  assert.deepEqual(await check('2026-11-12', true, '2026-11-13T22:00:00Z'), { status: 200, rpcCalls: 1 });
});
test('document valid today remains accessible', async () => {
  assert.deepEqual(await check('2026-11-13', false, '2026-11-13T22:00:00Z'), { status: 200, rpcCalls: 0 });
});
test('missing expiry follows existing access policy', async () => {
  assert.deepEqual(await check(null, false, '2026-11-13T22:00:00Z'), { status: 200, rpcCalls: 0 });
});
test('Lisbon midnight governs expiry rather than UTC midnight', async () => {
  assert.deepEqual(await check('2026-07-01', false, '2026-07-01T23:30:00Z'), { status: 403, rpcCalls: 1 });
});
