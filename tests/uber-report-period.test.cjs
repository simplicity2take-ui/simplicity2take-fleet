const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  for (const file of ['app.js', 'teste/app.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const calls = [];
    const context = { Date, URLSearchParams, loadBackendData: async () => {}, renderApp() {}, showToast() {}, alert() {}, window: { confirm: () => false }, supabaseClient: { functions: { invoke: async (name) => { calls.push(name); return { data: { ok: true, result: {} } }; } } } };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('function inferUberReportPeriod('), source.indexOf('\nasync function ', source.indexOf('async function importUberReport(') + 1)), context);
    for (const [name, start, end] of [
      ['20261109-20261110-driver_activity-company.csv', '2026-11-09', '2026-11-10'],
      ['20261110-20261110-trip_activity-company.csv', '2026-11-10', '2026-11-10'],
      ['20240229-20240301-driver_activity.csv', '2024-02-29', '2024-03-01'],
      ['activity.csv', '', ''],
      ['20260229-20260301-activity.csv', '', ''],
      ['20261111-20261110-activity.csv', '', ''],
    ]) {
      const period = context.inferUberReportPeriod(name);
      assert.equal(period.start, start);
      assert.equal(period.end, end);
    }
    const input = name => ({ files: [{ name, text: async () => 'CSV' }] });
    await assert.rejects(context.importUberReport('activity', input('activity.csv')), /período válido/);
    assert.equal(calls.length, 0, 'Missing periods must not reach the backend');
    await context.importUberReport('activity', input('20261109-20261110-driver_activity-company.csv'));
    const query = new URLSearchParams(calls[0].split('?')[1]);
    assert.equal(query.get('period_start'), '2026-11-09');
    assert.equal(query.get('period_end'), '2026-11-10');
    console.log(`${file}: PASS report date parsing, invalid-period protection and submitted period`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
