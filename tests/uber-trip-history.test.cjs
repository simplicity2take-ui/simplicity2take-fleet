const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const FixedDate = class extends Date { static now() { return Date.parse('2026-11-11T12:00:00Z'); } };

function contextFor(source, query) {
  const inputs = { '#uberRideDay': { value: '2026-11-10' }, '#uberRideFilter': { value: 'Ana' } };
  const context = {
    Date: FixedDate, Intl, Map, Set,
    state: { profile: { role: 'admin' }, sessionUserId: 'admin-a', activeView: 'activity', drivers: [{ id: 'driver-a', name: 'Ana Lima', uberDriverUuid: 'uuid-a' }] },
    document: { querySelector: selector => inputs[selector] }, renderActivity() {}, showToast(message) { context.toast = message; },
    escapeHtml: text => String(text ?? '').replace(/[&<>"']/g, value => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value])),
    supabaseClient: { from: query }, inputs
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function activityStateLabel('), source.indexOf('function renderActivity(')), context);
  return context;
}

(async () => {
  for (const file of ['app.js', 'teste/app.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const fixture = Array.from({ length: 18 }, (_, id) => ({ id: String(id), platform: 'uber', driver_id: 'driver-a', platform_driver_uuid: 'uuid-a', vehicle_plate: id < 7 ? 'AA-00-AA' : 'BB-00-BB', order_status: id === 6 ? 'rider_cancelled' : 'completed', observed_at: `2026-11-10T${id < 10 ? '0' : ''}${id}:00:00Z`, finished_at: null, ride_distance_km: 2 }));
    const calls = [];
    const builder = () => {
      const call = { orders: [], filters: [] }; calls.push(call);
      return { select() { return this; }, eq(k,v) { call.filters.push([k,v]); return this; }, gte(k,v) { call.start=v; return this; }, lt(k,v) { call.end=v; return this; }, order(k) { call.orders.push(k); return this; }, async range(start,end) { return { data: fixture.slice(start, Math.min(end+1,start+5)), count: fixture.length, error:null }; } };
    };
    const c = contextFor(source, builder);
    await c.loadUberRideHistory();
    assert.equal(c.state.uberRideHistory.rides.length, 18);
    assert.equal(c.state.uberRideHistory.partial, false);
    assert.equal(calls.length, 4, 'Reads all pages even when the server caps rows below the requested page size');
    assert.equal(calls[0].start, '2026-11-10T00:00:00.000Z');
    assert.equal(calls[0].end, '2026-11-11T00:00:00.000Z');
    assert.equal(calls[0].filters[0].join(','), 'platform,uber');
    assert.equal(calls[0].orders.join(','), 'observed_at,id');
    const rows = c.uberRideRows(fixture, c.state.drivers, 'ANA');
    assert.equal(rows.length, 18);
    assert.equal(c.uberRidePlateGroups(rows)[0].plates.size, 2);
    assert.equal(c.uberRideRows(fixture, c.state.drivers, 'AA00AA').length, 7);
    assert.equal(c.uberRideRows(fixture, c.state.drivers, 'nobody').length, 0);
    const html = c.renderUberRideHistory();
    assert.match(html, /hora exata da troca/);
    assert.match(html, /Cancelada pelo passageiro/);
    assert.equal((html.match(/<td>2.00<\/td>/g) || []).length, 17, 'Cancelled rows do not present completed-trip distance');
    c.state.drivers[0].name = '<img onerror=alert(1)>';
    c.state.uberRideFilter = '';
    assert.ok(!c.renderUberRideHistory().includes('<img onerror'));
    c.state.uberRideHistory = null;
    c.inputs['#uberRideDay'].value='2026-07-10';
    await c.loadUberRideHistory();
    assert.equal(calls.at(-1).start, '2026-07-09T23:00:00.000Z');
    assert.equal(calls.at(-1).end, '2026-07-10T23:00:00.000Z');
    c.state.uberRideHistory = null;
    c.inputs['#uberRideDay'].value='2026-02-31';
    const previousCalls=calls.length;
    await c.loadUberRideHistory();
    assert.equal(calls.length, previousCalls);
    c.state.profile.role='driver';
    c.inputs['#uberRideDay'].value='2026-11-10';
    await c.loadUberRideHistory();
    assert.equal(calls.length, previousCalls, 'Driver role cannot start an admin history query');

    let resolve;
    const pending = new Promise(done => { resolve=done; });
    const slow = contextFor(source, () => ({ select(){return this;},eq(){return this;},gte(){return this;},lt(){return this;},order(){return this;},range(){return pending;} }));
    const request=slow.loadUberRideHistory();
    slow.state.sessionUserId='another-user'; slow.state.uberRideHistory=null;
    resolve({data:fixture,count:18,error:null}); await request;
    assert.equal(slow.state.uberRideHistory,null,'A stale response cannot repopulate data after a session change');
    console.log(`${file}: PASS day boundaries/DST, pagination, plate changes, filtering, cancelled rows, escaping, role and stale-session guards`);
  }
})().catch(error => { console.error(error); process.exitCode=1; });
