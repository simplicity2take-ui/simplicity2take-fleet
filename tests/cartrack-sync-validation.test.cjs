const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../supabase/functions/cartrack-sync/index.ts'), 'utf8');
const handlerSource = stripTypeScriptTypes(source.replace(/^import .*;$/gm, ''));
const privateDetail = 'synthetic-private-detail';

async function synchronize(vehicles, statuses, dbFailure = false) {
  const writes = [];
  let handler;
  const responses = [vehicles, statuses].flat();
  const urls = [];
  const client = {
    async rpc(name, args) {
      if (name === 'verify_cartrack_sync_key') return { data: true };
      assert.equal(name, 'sync_cartrack_data');
      writes.push(args);
      return { error: dbFailure ? { message: privateDetail } : null };
    },
  };
  vm.runInNewContext(handlerSource, {
    Response, btoa, createClient: () => client,
    Deno: { env: { get: () => 'fixture' }, serve: callback => { handler = callback; } },
    fetch: async url => {
      urls.push(url);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response instanceof Response ? response : Response.json(response);
    },
  });
  const response = await handler(new Request('https://fleet.invalid', {
    method: 'POST', headers: { 'x-cartrack-sync-key': 'fixture' },
  }));
  const body = await response.json();
  assert.ok(!JSON.stringify(body).includes(privateDetail));
  return { status: response.status, body, writes, urls };
}

const roster = { data: [{ vehicle_id: 7, registration: ' xx-00-aa ' }] };
const telemetry = { data: [{ vehicle_id: 7, registration: '  XX-00-aa', odometer: 42, event_ts: '2026-07-10T23:45:00+01:00' }] };

test('sync matches normalized identities and keeps the original telemetry payload', async () => {
  const result = await synchronize(roster, telemetry);
  assert.equal(result.status, 200);
  assert.equal(result.body.vehiclesSaved, 1);
  assert.equal(result.body.snapshotsSaved, 1);
  assert.equal(result.writes.length, 1);
  const { p_vehicles: [vehicle], p_snapshots: [snapshot] } = result.writes[0];
  assert.equal(vehicle.registration, 'XX-00-AA');
  assert.equal(vehicle.odometer_km, 42);
  assert.equal(snapshot.registration, vehicle.registration);
  assert.equal(vehicle.raw.status.registration, telemetry.data[0].registration);
});

test('ambiguous registrations in either data set stop the entire sync', async () => {
  const duplicates = { data: [...roster.data, ...telemetry.data] };
  for (const inputs of [[duplicates, telemetry], [roster, duplicates]]) {
    const result = await synchronize(...inputs);
    assert.equal(result.status, 502);
    assert.equal(result.body.stage, 'validation');
    assert.equal(result.writes.length, 0);
  }
});

test('invalid lists and provider failures are distinct from successful empty data', async () => {
  for (const invalid of [
    { message: privateDetail }, { data: {} }, { data: [null] }, { data: [{ registration: {} }] },
    new Response(privateDetail, { status: 200 }), new Response(privateDetail, { status: 503 }),
    new Error(privateDetail),
  ]) {
    for (const stage of ['vehicles', 'status']) {
      const bad = invalid instanceof Response ? invalid.clone() : invalid;
      const result = stage === 'vehicles' ? await synchronize(bad, telemetry) : await synchronize(roster, bad);
      assert.equal(result.status, 502);
      assert.equal(result.body.stage, stage);
      assert.equal(result.writes.length, 0);
    }
  }
  const empty = await synchronize({ data: [] }, { data: [] });
  assert.equal(empty.body.success, true);
  assert.equal(empty.body.vehiclesSaved, 0);
});

test('database errors remain private and are returned as HTTP failure', async () => {
  const result = await synchronize(roster, telemetry, true);
  assert.equal(result.status, 500);
  assert.equal(result.body.success, false);
  assert.equal(result.body.stage, 'database');
});

test('matching plates require compatible provider IDs when both lists supply an ID', async () => {
  const withId = id => ({ data: [{ ...telemetry.data[0], vehicle_id: id }] });
  const conflicting = await synchronize(roster, withId(8));
  assert.equal(conflicting.status, 502);
  assert.equal(conflicting.writes.length, 0);
  for (const compatible of ['7', null]) {
    const result = await synchronize(roster, withId(compatible));
    assert.equal(result.body.success, true);
    assert.equal(result.writes[0].p_vehicles[0].vehicle_id, 7);
  }
});

test('missing telemetry stays unknown and a recorded zero remains zero', async () => {
  for (const [input, expected] of [[null, null], [undefined, null], ['  ', null], [0, 0], ['0', 0], [' 83.5 ', 83.5]]) {
    const reading = { registration: 'XX-00-AA', odometer: input, speed: input, event_ts: telemetry.data[0].event_ts };
    const result = await synchronize(roster, { data: [reading] });
    assert.equal(result.status, 200);
    const batch = result.writes[0];
    for (const row of [batch.p_vehicles[0], batch.p_snapshots[0]]) {
      assert.equal(row.odometer_km, expected);
      assert.equal(row.speed_kmh, expected);
    }
  }
});

test('invalid telemetry on any plate prevents the batch write', async () => {
  for (const field of ['odometer', 'speed']) {
    for (const value of [false, [], {}, 'unknown', -1, '1e999', '0x10']) {
      const bad = { registration: 'BB-11-BB', [field]: value };
      const result = await synchronize(roster, { data: [...telemetry.data, bad] });
      assert.equal(result.status, 502);
      assert.equal(result.body.stage, 'validation');
      assert.equal(result.writes.length, 0);
    }
  }
});

test('undated status is preserved on the vehicle without adding a dated mileage reading', async () => {
  for (const missing of [null, undefined, '', '  ']) {
    const data = [
      { ...telemetry.data[0], event_ts: missing },
      { registration: 'BB-11-BB', event_ts: telemetry.data[0].event_ts, odometer: 28 },
    ];
    const result = await synchronize(roster, { data });
    assert.equal(result.status, 200);
    const { p_vehicles: [vehicle], p_snapshots: snapshots } = result.writes[0];
    assert.equal(vehicle.odometer_km, 42);
    assert.equal(vehicle.event_ts, null);
    assert.ok(vehicle.last_synced_at);
    assert.equal(result.body.statusesFound, 2);
    assert.equal(result.body.snapshotsSaved, 1);
    assert.equal(result.body.statusesWithoutEventTime, 1);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].registration, 'BB-11-BB');
    assert.equal(snapshots[0].observed_at, '2026-07-10T22:45:00.000Z');
  }
});

test('invalid provider event times stop the batch before the database write', async () => {
  for (const value of ['not a date', true, {}, []]) {
    const result = await synchronize(roster, { data: [{ ...telemetry.data[0], event_ts: value }] });
    assert.equal(result.status, 502);
    assert.equal(result.body.stage, 'validation');
    assert.equal(result.writes.length, 0);
  }
});

const providerPage = (row, current, last) => ({
  data: [row], meta: { current_page: current, last_page: last, total: last },
});

test('both lists include all advertised pages before the single write', async () => {
  const second = { registration: 'BB-11-BB', vehicle_id: 8 };
  const result = await synchronize(
    [providerPage(roster.data[0], 1, 2), providerPage(second, 2, 2)],
    [providerPage({ ...second, odometer: 96 }, 1, 2), providerPage(telemetry.data[0], 2, 2)],
  );
  assert.equal(result.status, 200);
  assert.equal(result.writes.length, 1);
  assert.equal(result.body.vehiclesSaved, 2);
  assert.equal(result.body.statusesFound, 2);
  assert.equal(result.writes[0].p_vehicles[0].odometer_km, 42);
  assert.equal(result.writes[0].p_vehicles[1].odometer_km, 96);
  const urls = result.urls.map(address => new URL(address));
  assert.equal(urls[1].searchParams.get('page'), '2');
  assert.equal(urls[1].searchParams.get('limit'), '1000');
  assert.equal(urls[3].searchParams.get('page'), '2');
  assert.equal(urls[3].searchParams.get('odometer_in_km'), 'true');
});

test('incomplete, inconsistent or repeated pages do not write a partial fleet', async () => {
  const next = { registration: 'BB-11-BB' };
  for (const last of [
    new Response('', { status: 503 }), { data: [] }, { data: [next] },
    providerPage(next, 1, 2), providerPage(next, 2, 3),
    providerPage(roster.data[0], 2, 2), { ...providerPage(next, 2, 2), data: [] },
  ]) {
    for (const stage of ['vehicles', 'status']) {
      const list = [providerPage(roster.data[0], 1, 2), last];
      const r = stage === 'vehicles' ? await synchronize(list, telemetry) : await synchronize(roster, list);
      assert.equal(r.status, 502);
      assert.equal(r.writes.length, 0);
    }
  }
});

test('counts, continuation hints and page limits must agree before saving', async () => {
  for (const extra of [
    { meta: { current_page: 2 } }, { meta: { last_page: 101 } },
    { meta: { last_page: 'bad' } }, { meta: { last_page: 1, total: 2 } },
    { meta: { next_page_url: 'https://other.invalid/page' } },
    { links: { next: 'https://other.invalid/page' } },
  ]) {
    const r = await synchronize({ ...roster, ...extra }, telemetry);
    assert.equal(r.status, 502);
    assert.equal(r.writes.length, 0);
    assert.equal(r.urls.length, 1);
  }
  const emptyLast = await synchronize([
    { data: roster.data, meta: { last_page: 2 } },
    { data: [], meta: { last_page: 2 } },
  ], telemetry);
  assert.equal(emptyLast.status, 502);
  assert.equal(emptyLast.writes.length, 0);
  const r = await synchronize({ data: [], meta: { last_page: '0', total: '0' } }, telemetry);
  assert.equal(r.status, 200);
  assert.equal(r.body.vehiclesSaved, 0);
});
