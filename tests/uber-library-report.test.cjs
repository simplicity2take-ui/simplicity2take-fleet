const {test}=require('node:test'),assert=require('node:assert/strict'),{parseCsv,localTimestamp,prepareReport,buildInsertSql}=require('../scripts/uber-trip-report.cjs');
const driver='10000000-0000-4000-8000-000000000001',vehicle='20000000-0000-4000-8000-000000000001',du='30000000-0000-4000-8000-000000000001',vu='40000000-0000-4000-8000-000000000001',trip='50000000-0000-4000-8000-000000000001';
const headers=['UUID da viagem','UUID do motorista','UUID do veículo','Matrícula','Estado da viagem','Hora do pedido de viagem','Hora de chegada da viagem','Distância da viagem','Endereço de recolha'];
const values=[trip,du,vu,'AA-00-AA','completed','2026-11-11 10:00:00','2026-11-11 10:20:00','5.2','PRIVATE ADDRESS'];
const csv=(rows=[values])=>headers.join(',')+'\r\n'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
const options={drivers:[{id:driver,uber_driver_uuid:du}],vehicles:[{id:vehicle,uber_vehicle_uuid:vu,plate:'AA-00-AA'}],source:{original_upload:true,library_file_id:'libfile_fixture',file_id:'file_fixture',file_name:'fixture.csv'},now:Date.parse('2026-11-12T12:00:00Z')};
test('whitelists source data, keeps requests out of acceptance and preserves original hash',()=>{
 const r=prepareReport(csv(),options);assert.equal(r.records.length,1);const t=r.records[0];assert.equal(t.accepted_at,null);assert.equal(t.pickup_at,null);assert.equal(t.finished_at,'2026-11-11T10:20:00.000Z');assert.equal(t.ride_distance_km,5.2);assert(!JSON.stringify(r).includes('PRIVATE ADDRESS'));assert.equal(r.meta.coverage_verified,false);
 assert.equal(prepareReport(csv(),options).meta.sha256,r.meta.sha256);assert.notEqual(prepareReport('\uFEFF'+csv(),options).meta.sha256,r.meta.sha256);
 assert.throws(()=>buildInsertSql({...r,meta:{...r.meta,mapping_sha256:"bad';drop table drivers;--"}}));assert.throws(()=>buildInsertSql({...r,records:[]}));
});
test('CSV quoting, duplicate headers, malformed records and unclosed quotes are checked',()=>{
 const v=[...values];v[8]='two lines\n"quoted", address';assert.equal(parseCsv(csv([v]))[0]['Endereço de recolha'],v[8]);
 assert.throws(()=>parseCsv(csv().replace('UUID do motorista','UUID da viagem')));assert.throws(()=>parseCsv(csv()+'\n"unclosed'));assert.throws(()=>parseCsv(headers.join(',')+'\nwrong,row'));
});
test('Lisbon summer/winter, explicit offsets and DST ambiguity preserve source meaning',()=>{
 assert.equal(localTimestamp('2026-07-10 10:00:00'),'2026-07-10T09:00:00.000Z');assert.equal(localTimestamp('2026-11-10 10:00:00'),'2026-11-10T10:00:00.000Z');assert.equal(localTimestamp('2026-10-25T01:30:00+01:00'),'2026-10-25T00:30:00.000Z');
 for(const t of ['2026-10-25 01:30:00','2026-03-29 01:30:00','2026-02-30 10:00:00','2026-11-11T10:00:00+99:00'])assert.throws(()=>localTimestamp(t));assert.equal(localTimestamp(''),null);
});
test('known UUIDs are mandatory; names and current assignments cannot substitute them',()=>{
 assert.equal(prepareReport(csv(),{...options,drivers:[]}).records.length,0);assert.equal(prepareReport(csv(),{...options,vehicles:[{...options.vehicles[0],plate:'BB-11-BB'}]}).records.length,0);
 assert.equal(prepareReport(csv(),{...options,drivers:[...options.drivers,{id:'10000000-0000-4000-8000-000000000002',uber_driver_uuid:du}]}).records.length,0);
 assert.throws(()=>prepareReport(csv(),{...options,source:{...options.source,original_upload:false}}));
});
test('cancellations without vehicle are preserved without invented service times',()=>{
 const v=[...values];v[2]='';v[3]='';v[4]='rider_cancelled';v[6]='';const r=prepareReport(csv([v]),options),t=r.records[0];assert.equal(t.vehicle_id,null);assert.equal(t.finished_at,null);assert.equal(t.observed_at,'2026-11-11T10:00:00.000Z');
});
test('duplicate conflict never picks a winning row, including invalid-first duplicates',()=>{
 assert.equal(prepareReport(csv([values,values]),options).records.length,1);const other=[...values];other[6]='2026-11-11 10:30:00';assert.equal(prepareReport(csv([values,other]),options).records.length,0);
 const bad=[...values];bad[1]='bad';assert.equal(prepareReport(csv([bad,values]),options).records.length,0);
});
test('invalid, future and reversed source times do not fall back to now',()=>{
 for(const delta of [{5:'',6:''},{6:'2026-11-11 09:00:00'},{5:'2026-11-15 10:00:00',6:'2026-11-15 10:20:00'},{7:'-'},{7:'9'.repeat(400)}]){const v=[...values];for(const [i,x]of Object.entries(delta))v[i]=x;assert.equal(prepareReport(csv([v]),options).records.length,0);}
});
module.exports={csv,values,options,driver,vehicle};
