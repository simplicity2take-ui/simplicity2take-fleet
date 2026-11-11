const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 for(const file of ['app.js','teste/app.js']){
  const source=fs.readFileSync(file,'utf8');let reply={data:{can_start:false,has_open_shift:false}},calls=0,fail=false;
  const c={state:{sessionUserId:'u',profile:{role:'driver'},nativeShiftAvailable:true,activeView:'vehicles'},supabaseClient:{rpc:async()=>{calls++;if(fail)throw Error('offline');return reply;}}};
  vm.createContext(c);vm.runInContext(source.slice(source.indexOf('async function loadNativeShiftAccess('),source.indexOf('function renderNativeShift(')),c);
  await c.loadNativeShiftAccess();assert.equal(c.state.nativeShiftAvailable,false);
  reply={data:{can_start:true,has_open_shift:false}};await c.loadNativeShiftAccess();assert.equal(c.state.nativeShiftAvailable,true);
  reply={data:{can_start:false,has_open_shift:true}};await c.loadNativeShiftAccess();assert.equal(c.state.nativeShiftAvailable,true);
  reply={data:{can_start:'true'}};await c.loadNativeShiftAccess();assert.equal(c.state.nativeShiftAvailable,false);
  reply={data:{can_start:true},error:true};await c.loadNativeShiftAccess();assert.equal(c.state.nativeShiftAvailable,false);
  fail=true;await c.loadNativeShiftAccess();assert.equal(c.state.nativeShiftAvailable,false);fail=false;
  const n=calls;c.state.profile.role='admin';await c.loadNativeShiftAccess();assert.equal(calls,n);c.state.profile.role='driver';
  let resolve;c.supabaseClient.rpc=()=>new Promise(r=>resolve=r);const pending=c.loadNativeShiftAccess();c.state.sessionUserId='other';resolve({data:{can_start:true}});await pending;assert.equal(c.state.nativeShiftAvailable,false);
  c.navByRole={driver:[['shift','O meu turno','TU'],['vehicles','Meus Veículos','VE']]};c.currentUser=()=>({role:'driver'});c.selectors={sideNav:{}};c.renderApp=()=>{};c.nativeShiftPortal={load:async()=>{}};
  vm.runInContext(source.slice(source.indexOf('function renderNav('),source.indexOf('function renderContent(')),c);
  c.renderNav();assert.ok(!c.selectors.sideNav.innerHTML.includes('data-view="shift"'));c.setView('shift');assert.equal(c.state.activeView,'vehicles');
  c.state.nativeShiftAvailable=true;c.renderNav();assert.ok(c.selectors.sideNav.innerHTML.includes('data-view="shift"'));c.setView('shift');assert.equal(c.state.activeView,'shift');
  console.log(file+': PASS server feature access, own-open-session recovery, unavailable/stale access rejection, and preserved navigation');
 }
})().catch(e=>{console.error(e);process.exitCode=1});
