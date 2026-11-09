const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
  let token='assigned-token';
  const assigned={id:'assigned',qrToken:'assigned-token',driverIds:['driver']};
  const other={id:'other',qrToken:'other-token',driverIds:['someone-else']};
  const context={state:{vehicles:[assigned,other],requestedVehicleId:'stale'},requestedVehicleToken:()=>token,currentUser:()=>({role:'driver',driverId:'driver'}),showToast:()=>{}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function openRequestedVehicle('),source.indexOf('\nfunction showVehicleQr(')),context);
  await context.openRequestedVehicle();assert.equal(context.state.requestedVehicleId,'assigned');
  token='other-token';await context.openRequestedVehicle();assert.equal(context.state.requestedVehicleId,null);
  token='invalid';await context.openRequestedVehicle();assert.equal(context.state.requestedVehicleId,null);
  token='';context.state.requestedVehicleId='stale';await context.openRequestedVehicle();assert.equal(context.state.requestedVehicleId,null);
  context.state.requestedVehicleId='assigned';context.selectors={pageTitle:{},content:{}};
  context.driverVehicles=()=>[assigned];context.isVehicleQrMode=()=>true;context.vehicleAccessPanel=v=>'panel:'+v.id;
  vm.runInContext(source.slice(source.indexOf('function renderVehicles('),source.indexOf('\nfunction vehicleAccessPanel(')),context);
  context.renderVehicles();assert.equal(context.selectors.content.innerHTML,'panel:assigned');
  console.log('PASS: assigned QR accepted, unassigned/invalid QR rejected, stale selection cleared, driver QR opens selected vehicle panel.');
})().catch(error=>{console.error(error);process.exitCode=1});
