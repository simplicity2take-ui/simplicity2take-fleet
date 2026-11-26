const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const functions = (start, end) => source.slice(source.indexOf('function '+start+'('), source.indexOf('\nfunction '+end+'('));

test('vehicle list and details show a dated odometer for a uniquely identified vehicle', () => {
  const now = Date.parse('2026-07-15T12:00:00Z');
  const vehicle = {plate:'AA-00-AA',driverIds:[]};
  const row = {registration:' aa00aa ',vehicleId:137,odometerKm:0,eventTs:'2026-07-15T12:00:00Z'};
  const state = {vehicles:[vehicle],cartrackVehicles:[row],documents:[]};
  const c = {state, ShiftMileage:require('../shift-mileage.js'), Date:class extends Date {static now(){return now;}},
    driverName:String, escapeHtml:value=>String(value??''), vehicleDocumentsPanel:()=>''};
  vm.createContext(c);
  for (const code of [functions('normalizePlateSearch','searchVehicles'),functions('cartrackTimestampIsStale','uberRideRows'),functions('vehicleOdometer','renderDrivers')]) vm.runInContext(code,c);
  const display = () => c.vehicleOdometer(vehicle);
  assert.match(display(),/0 km · CarTrack/);
  assert.match(display(),/13:00:00 \(Lisboa\)/);
  assert.doesNotMatch(display(),/antiga/);
  row.odometerKm=12345;
  row.eventTs='2026-07-15T10:00:00Z';
  row.lastSyncedAt=new Date(now).toISOString();
  for (const render of [c.vehicleRow,c.vehicleAccessPanel]) {
    assert.match(render(vehicle,true),/Leitura antiga/);
    assert.doesNotMatch(render(vehicle,false),/Odómetro|CarTrack/);
  }
  for (const value of [null,'',false,'invalid',-1,Infinity]) {
    row.odometerKm=value;
    assert.match(display(),/Sem leitura/);
  }
  row.odometerKm=120;
  for (const value of [null,'2026-07-15T13:00:00Z','invalid']) {
    row.eventTs=value;
    assert.match(display(),/Data da leitura CarTrack por confirmar/);
  }
  state.cartrackVehicles.push({...row,registration:vehicle.plate});
  assert.match(display(),/Correspondência CarTrack por confirmar/);
  state.cartrackVehicles.pop();
  state.vehicles.push({plate:'AA00AA'});
  assert.match(display(),/Correspondência CarTrack por confirmar/);
  state.cartrackVehicles=[];
  assert.match(display(),/Sem leitura CarTrack/);
  vehicle.plate='---';
  assert.match(display(),/Matrícula por confirmar/);
});

test('loaded CarTrack readings distinguish a real zero, an import default and conflicting history', async () => {
  const now = Date.parse('2026-07-15T12:00:00Z');
  const observed = '2026-07-15T11:55:00Z';
  const vehicle = {plate:'AA-00-AA'};
  const current = {registration:'AA00AA',vehicle_id:42,odometer_km:0,event_ts:observed,raw:{status:{odometer:' '}}};
  const snapshot = {registration:'aa-00-aa',vehicle_id:'42',odometer_km:110,observed_at:observed,raw:{event_ts:observed,odometer:110}};
  const tables = {cartrack_vehicles:[current],cartrack_vehicle_snapshots:[]};
  const client = {from(table) {
    const query = {select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},
      then(resolve){return resolve({data:tables[table] || [],count:0});}};
    return query;
  }};
  const c = {state:{profile:{role:'admin'}},supabaseClient:client,loadPlatformTripRecords:async()=>({data:[]}),
    ShiftMileage:require('../shift-mileage.js'),Date:class extends Date {static now(){return now;}}};
  vm.createContext(c);
  for (const code of [functions('normalizePlateSearch','searchVehicles'),functions('cartrackTimestampIsStale','uberRideRows'),functions('vehicleOdometer','renderDrivers'),
    source.slice(source.indexOf('async function loadBackendData('),source.indexOf('function assignmentIsActive('))]) vm.runInContext(code,c);
  async function display() {
    await c.loadBackendData();
    c.state.vehicles=[vehicle];
    return c.vehicleOdometer(vehicle);
  }
  assert.match(await display(),/Sem leitura de odómetro/);
  current.raw.status.odometer='0';
  current.odometer_km='0';
  assert.match(await display(),/^0 km/);
  current.odometer_km=100;current.raw.status.odometer=100;
  tables.cartrack_vehicle_snapshots=[snapshot];
  assert.match(await display(),/Divergência/);
  const earlier='2026-07-15T11:00:00Z', later='2026-07-15T11:58:00Z';
  snapshot.observed_at=snapshot.raw.event_ts=earlier;
  assert.match(await display(),/Divergência/);
  snapshot.observed_at=snapshot.raw.event_ts=later;
  assert.match(await display(),/posterior/);
  for (const change of [{vehicle_id:43},{registration:'BB00BB'},{raw:{}},{observed_at:earlier},{raw:{event_ts:later,odometer:false}}]) {
    tables.cartrack_vehicle_snapshots=[{...snapshot,...change}];
    assert.doesNotMatch(await display(),/posterior|Divergência/);
  }
  tables.cartrack_vehicle_snapshots=[
    {...snapshot,odometer_km:0,raw:{odometer:false,event_ts:later}},
    {...snapshot,odometer_km:0,raw:{odometer:0,event_ts:later}}
  ];
  await display();
  assert.deepEqual(Array.from(c.state.cartrackSnapshots, point=>point.odometerKm),[null,0]);
  tables.cartrack_vehicle_snapshots=[];
  current.raw=null;
  current.odometer_km='120.5';
  assert.match(await display(),/120,5 km/);
  tables.cartrack_vehicle_snapshots=[{...snapshot,odometer_km:120.5,raw:{event_ts:earlier,odometer:'120.5'},observed_at:earlier}];
  current.event_ts='2026-07-15 11:55:00+00';
  assert.doesNotMatch(await display(),/antiga/);
});
