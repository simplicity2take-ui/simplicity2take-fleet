const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function portal(file) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  let now = Date.parse('2026-07-10T22:59:59Z');
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const records = {
    drivers: [{ id: 'a', profile_id: 'p', status: 'Ativo' }],
    vehicles: [{ id: 'old' }, { id: 'new' }, { id: 'no-start' }],
    vehicle_assignments: [
      { vehicle_id: 'old', driver_id: 'a', active_from: '2026-07-01', active_until: '2026-07-10' },
      { vehicle_id: 'new', driver_id: 'a', active_from: '2026-07-11', active_until: null },
      { vehicle_id: 'no-start', driver_id: 'a', active_from: null, active_until: null },
    ],
    documents: [
      { id: 'own', driver_id: 'a' }, { id: 'foreign', driver_id: 'b' },
      { id: 'expired', driver_id: 'a', expiry_date: '2026-07-09' },
      { id: 'last-day', driver_id: 'a', expiry_date: '2026-07-10' },
      { id: 'old-car', vehicle_id: 'old' }, { id: 'new-car', vehicle_id: 'new' },
      { id: 'unknown-start', vehicle_id: 'no-start' },
      { id: 'mixed', driver_id: 'a', vehicle_id: 'old' },
      { id: 'company' }, { id: 'revoked' },
    ],
    document_viewers: ['foreign', 'company', 'new-car', 'mixed', 'revoked'].map(id => ({
      driver_id: 'a', document_id: id, can_view: id !== 'revoked',
    })),
  };
  const state = { profile: { id: 'p', role: 'driver', status: 'Ativo' } };
  const ctx = vm.createContext({
    Date: Clock, Intl, state,
    loadPlatformTripRecords: async () => ({ data: [] }),
    supabaseClient: { from(table) {
      const query = {
        select: () => query, eq: () => query, order: () => query, limit: () => query,
        then(resolve) { resolve({ data: records[table] || [], error: null }); },
      };
      return query;
    } },
  });
  for (const [start, end] of [
    ['function currentUser(', 'async function loadPlatformTripRecords('],
    ['async function loadBackendData(', 'function escapeHtml('],
    ['function driverDocuments(', 'function showToast('],
    ['function localDay(', 'function reportDayShift('],
  ]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), ctx);
  return { ctx, state, ids: () => Array.from(ctx.visibleDocuments(), d => d.id).sort(),
    advance: () => { now += 1000; } };
}

for (const file of ['app.js', 'teste/app.js']) {
  test(file + ' filters document ownership and rechecks cached assignments at Lisbon midnight', async () => {
    const { ctx, state, ids, advance } = portal(file);
    await ctx.loadBackendData();
    assert.deepEqual(ids(), ['company', 'last-day', 'old-car', 'own']);
    advance();
    assert.deepEqual(ids(), ['company', 'new-car', 'own']);
    state.profile.role = 'admin';
    assert.equal(ids().length, 10);
    assert.deepEqual(Array.from(state.vehicles.find(vehicle => vehicle.id === 'no-start').driverIds), ['a']);
  });
  test(file + ' requires an active driver linked to the signed-in driver profile', async () => {
    const { ctx, state, ids } = portal(file);
    await ctx.loadBackendData();
    state.profile.status = 'Inativo';
    assert.deepEqual(ids(), []);
    state.profile.status = 'Ativo';
    state.profile.role = 'candidate';
    assert.deepEqual(ids(), []);
    state.profile.role = 'driver';
    state.drivers[0].raw.status = null;
    assert.deepEqual(ids(), []);
    state.drivers[0].raw.status = 'Ativo';
    state.profile.driver_id = 'a';
    state.profile.id = 'other-profile';
    assert.deepEqual(ids(), []);
  });
}
