const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');

const source = stripTypeScriptTypes(
  fs.readFileSync('supabase/functions/uber-report-import/index.ts', 'utf8').replace(/^import .*;\n/gm, '')
);

const driverId = '10000000-0000-4000-8000-000000000001';
const storedDriverUuid = '20000000-0000-4000-8000-000000000001';
const sourceDriverUuid = '20000000-0000-4000-8000-000000000002';
const firstVehicleId = '30000000-0000-4000-8000-000000000001';
const secondVehicleId = '30000000-0000-4000-8000-000000000002';
const sourceVehicleUuid = '40000000-0000-4000-8000-000000000001';
const otherVehicleUuid = '40000000-0000-4000-8000-000000000002';
const tripId = '50000000-0000-4000-8000-000000000001';
const csv = [
  'UUID da viagem,UUID do motorista,Nome próprio do motorista,Apelido do motorista,UUID do veículo,Matrícula,Estado da viagem,Hora do pedido de viagem,Hora de chegada da viagem,Distância da viagem',
  [tripId, sourceDriverUuid, 'Ana', 'Silva', sourceVehicleUuid, 'AA-00-AA', 'completed', '2026-11-11 10:00:00', '2026-11-11 10:20:00', '5.2'].join(',')
].join('\n');

let handler;
const existingTripIds = new Set();
const writes = [];
const fetch = async (url, options = {}) => {
  if (url.endsWith('/auth/v1/user')) {
    return new Response(JSON.stringify({ id: '00000000-0000-4000-8000-000000000001' }), { status: 200 });
  }
  if (url.includes('/profiles?')) {
    return new Response(JSON.stringify([{ role: 'admin', status: 'Ativo' }]), { status: 200 });
  }
  if (url.includes('/drivers?')) {
    return new Response(JSON.stringify([
      { id: driverId, uber_driver_uuid: storedDriverUuid, full_name: 'Ana Silva' }
    ]), { status: 200 });
  }
  if (url.includes('/vehicles?')) {
    return new Response(JSON.stringify([
      { id: firstVehicleId, uber_vehicle_uuid: sourceVehicleUuid, plate: 'BB-11-BB' },
      { id: secondVehicleId, uber_vehicle_uuid: otherVehicleUuid, plate: 'AA-00-AA' }
    ]), { status: 200 });
  }
  if (url.includes('/platform_trip_records?select=source_trip_id')) {
    const rows = Array.from(existingTripIds).map(source_trip_id => ({ source_trip_id }));
    return new Response(JSON.stringify(rows), { status: 200 });
  }
  if (url.includes('/platform_trip_records?on_conflict=')) {
    const rows = JSON.parse(options.body);
    writes.push({ rows, prefer: options.headers.Prefer });
    for (const row of rows) existingTripIds.add(row.source_trip_id);
    return new Response('', { status: 201 });
  }
  throw new Error('Unexpected network access: ' + url);
};

vm.runInNewContext(source, {
  Deno: { env: { get: () => 'test-only' }, serve: fn => { handler = fn; } },
  fetch, Request, Response, Headers, URL, Date, TextEncoder, Uint8Array,
  crypto: webcrypto, console: { info() {}, error() {} },
  Number, Array, JSON, Map, Set, Intl
});

const request = dryRun => new Request(
  'https://fixture.test/?type=trip-activity' + (dryRun ? '&dry_run=true' : ''),
  { method: 'POST', headers: { Authorization: 'Bearer test-user' }, body: csv }
);

(async () => {
  const previewResponse = await handler(request(true));
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.result.uniqueTrips, 1);
  assert.equal(preview.result.linkedDrivers, 0,
    'A matching display name must not override a different platform driver UUID');
  assert.equal(preview.result.linkedVehicles, 0,
    'A vehicle UUID and a plate belonging to different vehicles must not create a link');

  const firstResponse = await handler(request(false));
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.result.saved, 1);
  assert.equal(first.result.alreadyImported, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].prefer, 'resolution=ignore-duplicates,return=minimal');
  assert.equal(writes[0].rows[0].driver_id, null);
  assert.equal(writes[0].rows[0].vehicle_id, null);

  const secondResponse = await handler(request(false));
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json();
  assert.equal(second.result.saved, 0);
  assert.equal(second.result.alreadyImported, 1);
  assert.equal(second.result.newTrips, 0);
  assert.equal(writes.length, 1,
    'Importing the same CSV twice must not issue a second trip write');

  console.log('PASS Uber trips: authoritative driver UUID, coherent vehicle identity and duplicate-file idempotency');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
