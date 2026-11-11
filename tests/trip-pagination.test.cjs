const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  for (const file of ['app.js', 'teste/app.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const [total, serverCap, expected] of [[1719, 1000, 1719], [1719, 100, 1719], [0, 1000, 0], [5100, 1000, 5000]]) {
      const calls = [];
      const rows = Array.from({ length: total }, (_, id) => ({ id }));
      const client = { from(table) {
        assert.equal(table, 'platform_trip_records');
        const orders = [];
        return { select() { return this; }, in(column, values) { assert.equal(column, 'platform'); assert.equal(values.join(','), 'bolt,uber'); return this; }, order(column) { orders.push(column); return this; }, async range(start, end) { assert.equal(orders.join(','), 'observed_at,id'); calls.push([start, end]); return { data: rows.slice(start, Math.min(end + 1, start + serverCap)), error: null }; } };
      } };
      const context = { supabaseClient: client }; vm.createContext(context);
      vm.runInContext(source.slice(source.indexOf('async function loadPlatformTripRecords('), source.indexOf('async function loadBackendData(')), context);
      const result = await context.loadPlatformTripRecords();
      assert.equal(result.error, null);
      assert.equal(result.data.length, expected);
      assert.equal(new Set(result.data.map(row => row.id)).size, expected);
      if (expected) assert.equal(result.data.at(-1).id, expected - 1);
      assert.ok(calls.every(([start, end]) => end - start < 500));
    }
    let page = 0;
    const error = new Error('second page failed');
    const builder = { select() { return this; }, in() { return this; }, order() { return this; }, async range() { return ++page === 1 ? { data: [{ id: 1 }], error: null } : { data: null, error }; } };
    const context = { supabaseClient: { from: () => builder } }; vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('async function loadPlatformTripRecords('), source.indexOf('async function loadBackendData(')), context);
    const result = await context.loadPlatformTripRecords();
    assert.equal(result.error, error);
    assert.equal(result.data, null, 'Do not present a partial history as a successful load');
    console.log(`${file}: PASS API row caps, complete pages, 5000-row bound, stable ordering and partial-error propagation`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
