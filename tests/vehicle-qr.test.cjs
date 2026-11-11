const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 for(const file of ['app.js','teste/app.js']){
  const source=fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8');
  let token='assigned-token';
  const assigned={id:'assigned',qrToken:'assigned-token',driverIds:['driver']};
  const other={id:'other',qrToken:'other-token',driverIds:['someone-else']};
  const lookups=[];
  const context={state:{vehicles:[assigned,other],requestedVehicleId:'stale',nativeShiftAvailable:true},nativeShiftPortal:{lookup:async value=>lookups.push(value)},requestedVehicleToken:()=>token,currentUser:()=>({role:'driver',driverId:'driver'}),showToast:()=>{}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function openRequestedVehicle('),source.indexOf('\nfunction showVehicleQr(')),context);
  await context.openRequestedVehicle();assert.equal(context.state.activeView,'shift');assert.equal(context.state.requestedVehicleId,null);
  assert.deepEqual(lookups,['assigned-token']);
  token='other-token';await context.openRequestedVehicle();assert.equal(context.state.requestedVehicleId,null);
  token='invalid';await context.openRequestedVehicle();assert.equal(context.state.requestedVehicleId,null);
  token='';context.state.requestedVehicleId='stale';await context.openRequestedVehicle();assert.equal(context.state.requestedVehicleId,null);
  context.state.requestedVehicleId='assigned';context.selectors={pageTitle:{},content:{}};
  context.driverVehicles=()=>[assigned];context.isVehicleQrMode=()=>true;context.vehicleAccessPanel=v=>'panel:'+v.id;
  vm.runInContext(source.slice(source.indexOf('function renderVehicles('),source.indexOf('\nfunction vehicleAccessPanel(')),context);
  context.renderVehicles();assert.equal(context.selectors.content.innerHTML,'panel:assigned');
  assert.deepEqual(lookups,['assigned-token','other-token','invalid']);
  context.state.nativeShiftAvailable=false;token='assigned-token';await context.openRequestedVehicle();
  assert.equal(context.state.requestedVehicleId,'assigned');assert.equal(context.state.activeView,'vehicles');
  token='other-token';await context.openRequestedVehicle();assert.equal(context.state.requestedVehicleId,null);
  assert.deepEqual(lookups,['assigned-token','other-token','invalid']);
  console.log(file+': PASS authorized turn QR, no fixed assignment requirement, and original assigned-document QR flow for accounts without turn access.');
 }
})().catch(error=>{console.error(error);process.exitCode=1});
