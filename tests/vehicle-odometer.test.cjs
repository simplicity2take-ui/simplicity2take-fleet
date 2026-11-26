const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const functions = (start, end) => source.slice(source.indexOf('function '+start+'('), source.indexOf('\nfunction '+end+'('));

test('vehicle list and details show a dated odometer for a uniquely identified vehicle', () => {
  const now = Date.parse('2026-07-15T12:00:00Z');
  const vehicle = {plate:'AA-00-AA',driverIds:[]};
  const row = {registration:' aa00aa ',vehicleId:137,odometerKm:'0',eventTs:'2026-07-15T12:00:00Z'};
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
