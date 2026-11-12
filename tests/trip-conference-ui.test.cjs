const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const TripConference=require('../trip-conference.js');
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const tables={drivers:[{id:'d',full_name:'<img src=x>',bolt_driver_uuid:'bd'}],vehicles:[{id:'v',plate:'AA-00-AA',bolt_vehicle_uuid:'bv'}],platform_trip_records:[{id:'t',source_trip_id:'s',platform:'bolt',driver_id:'d',vehicle_id:'v',platform_driver_uuid:'bd',platform_vehicle_uuid:'bv',vehicle_plate:'AA-00-AA',order_status:'completed',accepted_at:'2026-11-10T10:00:00Z',finished_at:'2026-11-10T10:30:00Z'}],vehicle_shift_events:[],driver_shift_sessions:[]};
function setup(page){
  let user={id:'admin',role:'admin'},calls=0,changes=0;
  const client={from:table=>{calls++;const q={select(){return q},in(){return q},or(){return q},order(){return q},gte(){return q},lt(){return q},range:async(a,b)=>page?page(table,a,b):{data:(tables[table]||[]).slice(a,b+1),count:(tables[table]||[]).length}};return q;}};
  const context={TripConference,Date,Map,Set,Promise};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../trip-conference-ui.js'),'utf8'),context);
  const portal=context.TripConferencePortal.create({client,getUser:()=>user,escapeHtml,changed:()=>changes++,today:()=> '2026-11-12',getCartrack:()=>[],getRange:day=>day==='2026-11-10'?{start:Date.parse(day+'T00:00:00Z'),end:Date.parse('2026-11-11T00:00:00Z')}:null});
  return {portal,setUser:x=>user=x,get calls(){return calls},get changes(){return changes}};
}
test('admin-only read view, escaped names, no inferred mileage, invalid dates before queries',async()=>{
  const s=setup();s.setUser({id:'driver',role:'driver'});await s.portal.load({day:'2026-11-10'});assert.equal(s.calls,0);assert.equal(s.portal.render(),'');
  s.setUser({id:'admin',role:'admin'});await s.portal.load({day:'bad'});assert.equal(s.calls,0);assert.match(s.portal.render(),/dia válido/);
  await s.portal.load({day:'2026-11-10',filter:'AA00AA'});const html=s.portal.render();assert.match(html,/&lt;img src=x&gt;/);assert(!html.includes('<img src=x>'));assert.match(html,/1 serviços concluídos/);assert.match(html,/não são horas de entrada e saída/);assert.match(html,/Sem leituras na lista sincronizada/);
});
test('page cap, missing counts and changing totals are labeled partial',async()=>{
  const s=setup(async table=>({data:tables[table]||[],count:null}));await s.portal.load({day:'2026-11-10'});assert.match(s.portal.render(),/Consulta parcial/);
  let p=0;const changing=setup(async(table,a,b)=>{if(table!=='platform_trip_records')return {data:tables[table],count:tables[table].length};p++;return {data:Array.from({length:p===1?500:1},(_,i)=>({...tables.platform_trip_records[0],id:String(a+i),source_trip_id:String(a+i)})),count:p===1?502:501}});
  await changing.portal.load({day:'2026-11-10'});assert.equal(p,2);assert.match(changing.portal.render(),/Consulta parcial/);
  let calls=0;const cap=setup(async(table,a)=>{if(table!=='platform_trip_records')return {data:tables[table],count:tables[table].length};calls++;return {data:Array.from({length:500},(_,i)=>({...tables.platform_trip_records[0],id:String(a+i),source_trip_id:String(a+i)})),count:6000}});await cap.portal.load({day:'2026-11-10'});assert.equal(calls,10);assert.match(cap.portal.render(),/Consulta parcial/);
});
test('read failure clears results; logout discards late responses',async()=>{
  const failed=setup(async()=>({data:null,error:true}));await failed.portal.load({day:'2026-11-10'});assert.match(failed.portal.render(),/Não foi possível/);assert(!failed.portal.render().includes('serviços concluídos identificados'));
  let release;const pending=new Promise(resolve=>release=resolve);const s=setup(async()=>{await pending;return {data:[],count:0}});const work=s.portal.load({day:'2026-11-10'});s.portal.clear();s.setUser({id:'another-admin',role:'admin'});release();await work;assert(!s.portal.render().includes('serviços concluídos identificados'));assert(!s.portal.render().includes('A conferir…'));
});
test('cached results disappear if the account changes without an explicit clear',async()=>{
  const s=setup();await s.portal.load({day:'2026-11-10',filter:'img'});assert.match(s.portal.render(),/&lt;img/);
  s.setUser({id:'another-admin',role:'admin'});const html=s.portal.render();assert(!html.includes('&lt;img'));assert(!html.includes('value="img"'));assert(!html.includes('serviços concluídos identificados'));
});
test('root and test portals load identical modules before app initialization',()=>{
  for(const file of ['trip-conference.js','trip-conference-ui.js'])assert.equal(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),fs.readFileSync(path.join(__dirname,'../teste',file),'utf8'));
  for(const prefix of ['','teste/']){const html=fs.readFileSync(path.join(__dirname,'..',prefix,'index.html'),'utf8');assert(html.indexOf('trip-conference.js')<html.indexOf('app.js?'));assert(html.indexOf('trip-conference-ui.js')<html.indexOf('app.js?'));}
});
