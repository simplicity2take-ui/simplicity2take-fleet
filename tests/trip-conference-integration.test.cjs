// Executes the real app factory, event handler and activity renderer with a read-only client.
// No browser, network, credentials or production writes are involved.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const TripConference=require('../trip-conference.js'),ShiftMileage=require('../shift-mileage.js');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const fixtures={drivers:[{id:'driver',full_name:'Motorista sintético',bolt_driver_uuid:'bd'}],vehicles:[{id:'vehicle',plate:'AA-00-AA',bolt_vehicle_uuid:'bv'}],platform_trip_records:[{id:'trip',platform:'bolt',source_trip_id:'source',driver_id:'driver',vehicle_id:'vehicle',platform_driver_uuid:'bd',platform_vehicle_uuid:'bv',vehicle_plate:'AA-00-AA',order_status:'completed',accepted_at:'2026-11-10T09:00:00Z',finished_at:'2026-11-10T10:00:00Z'}],vehicle_shift_events:[],driver_shift_sessions:[]};
function setup(file,page){
  const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8'),handlers={},inputs={'#tripConferenceDay':{value:'2026-11-10'},'#tripConferenceFilter':{value:''}},queries=[];
  let authChanged;
  const client={auth:{onAuthStateChange:fn=>authChanged=fn,getSession:async()=>({data:{session:null}})},from:table=>{
    const query={table};queries.push(query);
    const q={select(){return q},in(){return q},order(){return q},or(value){query.filter=value;return q},gte(){return q},lt(){return q},range:async(a,b)=>page?page(table,a,b):{data:fixtures[table].slice(a,b+1),count:fixtures[table].length}};return q;
  }};
  const c={Date,Intl,Map,Set,Number,Math,Promise,TripConference,ShiftMileage,console,
    state:{profile:{id:'admin',role:'admin',status:'Ativo'},sessionUserId:'admin',activeView:'activity',vehicles:[],cartrackVehicles:[]},
    selectors:{pageTitle:{},content:{},appShell:{classList:{add(){}}},loginScreen:{classList:{remove(){}}}},
    document:{querySelector:s=>inputs[s]||null,addEventListener:(name,fn)=>handlers[name]=fn},
    escapeHtml:esc,heading:()=>'',metric:()=>'',emptyRow:()=>'',supabaseClient:client,
    nativeShiftPortal:{adminPanel:()=>'',clear(){},load:async()=>{}},boltActivitySummary:()=>({trips:[],events:[],grouped:new Map(),latestByVehicle:new Map()}),
    isVehicleQrMode:()=>false,closeDocumentPreview:null,documentBlobCache:new Map()};
  c.currentUser=()=>c.state.profile;c.window=c;vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../trip-conference-ui.js'),'utf8'),c);
  vm.runInContext(source.slice(source.indexOf('function localDay('),source.indexOf('function activityReportRange(')),c);
  vm.runInContext(source.slice(source.indexOf('const tripConferencePortal ='),source.indexOf('async function loadNativeShiftAccess(')),c);
  vm.runInContext(source.slice(source.indexOf('function cartrackDistanceSummary('),source.indexOf('\nasync function syncCartrack(')),c);
  c.navByRole={admin:[['activity'],['dashboard']],driver:[['vehicles']]};c.renderApp=()=>{if(c.state.activeView==='activity')c.renderActivity();};
  vm.runInContext(source.slice(source.indexOf('function setView('),source.indexOf('function renderContent(')),c);
  vm.runInContext(source.slice(source.indexOf('function bindPortalEvents()'),source.indexOf('\ndocument.addEventListener("DOMContentLoaded"')),c);
  c.bindPortalEvents();
  const click=()=>handlers.click({target:{closest:selector=>{assert(selector.includes('button'));return {dataset:{tripConference:''}}}}});
  return {c,queries,inputs,click,signOut:()=>authChanged('SIGNED_OUT'),render:()=>vm.runInContext('tripConferencePortal.render()',c)};
}
for(const file of ['app.js','teste/app.js']){
  test(file+': entering Utilização triggers the real automatic conference load once',async()=>{
    const s=setup(file);s.c.setView('activity');await new Promise(resolve=>setImmediate(resolve));assert.equal(s.queries.length,5);assert.match(s.c.selectors.content.innerHTML,/serviços concluídos identificados/);
    s.c.setView('dashboard');s.c.setView('activity');await new Promise(resolve=>setImmediate(resolve));assert.equal(s.queries.length,5);
  });
  test(file+': actual conference button renders combined data and applies plate search',async()=>{
    const s=setup(file);s.c.renderActivity();assert.match(s.c.selectors.content.innerHTML,/href="#activity-conference"/);
    s.inputs['#tripConferenceFilter'].value='AA00AA';await s.click();assert.match(s.c.selectors.content.innerHTML,/Motorista sintético/);assert.match(s.c.selectors.content.innerHTML,/1 serviços concluídos identificados/);
    s.inputs['#tripConferenceFilter'].value='ZZ99ZZ';await s.click();assert(!s.c.selectors.content.innerHTML.includes('Motorista sintético'));assert.match(s.c.selectors.content.innerHTML,/0 combinações apresentadas/);
    assert.equal(s.queries.filter(q=>q.table==='platform_trip_records').length,2);
    s.inputs['#tripConferenceDay'].value='2026-10-25';await s.click();const q=s.queries.filter(q=>q.table==='platform_trip_records').at(-1);assert(q.filter.includes('2026-10-24T23:00:00.000Z'));assert(q.filter.includes('2026-10-26T00:00:00.000Z'));
  });
  test(file+': driver cannot trigger admin reads through a forged button',async()=>{
    const s=setup(file);s.c.state.profile={id:'driver',role:'driver'};await s.click();assert.equal(s.queries.length,0);assert.equal(s.render(),'');
  });
  test(file+': real sign-out handler discards in-flight conference results',async()=>{
    let release;const wait=new Promise(resolve=>release=resolve);const s=setup(file,async table=>{await wait;return {data:fixtures[table],count:fixtures[table].length}});
    const work=s.click();s.signOut();assert.equal(s.c.state.profile,null);release();await work;
    s.c.state.profile={id:'new-admin',role:'admin'};const html=s.render();assert(!html.includes('Motorista sintético'));assert(!html.includes('serviços concluídos identificados'));assert(!html.includes('A conferir…'));
  });
}
