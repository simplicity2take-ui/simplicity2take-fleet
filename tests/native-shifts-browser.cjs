// Synthetic browser test. Never sends credentials or writes to a real Supabase project.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.FLEET_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.FLEET_TEST_URL||'http://127.0.0.1:8127';
const stub=`(()=>{
 const user={id:'fixture-user',email:'driver@example.test'};
 const profile={id:user.id,role:'driver',status:'Ativo',full_name:'Motorista de teste',email:user.email};
 const driver={id:'fixture-driver',profile_id:user.id,full_name:profile.full_name,status:'Ativo'};
 const read=()=>JSON.parse(localStorage.getItem('fixture-shifts')||'[]');
 const callbacks=[];
 const client={auth:{onAuthStateChange:fn=>{callbacks.push(fn);return {data:{subscription:{unsubscribe(){}}}}},getSession:async()=>({data:{session:localStorage.getItem('fixture-login')?{user}:null}}),signInWithPassword:async()=>{localStorage.setItem('fixture-login','yes');return {data:{user}}},signOut:async()=>{localStorage.removeItem('fixture-login');callbacks.forEach(fn=>fn('SIGNED_OUT'));return {error:null}}},
 from:table=>{const q={select(){return q},eq(){return q},in(){return q},order(){return q},range(){return q},limit(){return q},single(){return q},then(resolve){return Promise.resolve({data:table==='profiles'?profile:table==='drivers'?[driver]:table==='driver_shift_sessions'?read():[],count:0,error:null}).then(resolve)}};return q},
 rpc:async(name,args)=>{
  if(name==='fleet_shift_access')return {data:{can_start:true,has_open_shift:read().some(x=>!x.ended_at)}};
  if(name==='fleet_shift_vehicle'){
   const second=args.p_token==='b'.repeat(32);
   return {data:{id:second?'second-vehicle':'fixture-vehicle',plate:second?'BB-11-BB':'AA-00-AA',brand:'Marca',model:'Modelo'}};
  }
  const rows=read();
  if(name==='fleet_shift_start'){
   const existing=rows.find(x=>x.start_request_id===args.p_request_id);if(existing)return {data:existing};
   if(rows.some(x=>!x.ended_at))return {error:{message:'open'}};
   const shift={id:'fixture-shift',driver_id:driver.id,driver_name:profile.full_name,vehicle_id:args.p_token==='b'.repeat(32)?'second-vehicle':'fixture-vehicle',vehicle_plate:args.p_token==='b'.repeat(32)?'BB-11-BB':'AA-00-AA',started_at:new Date().toISOString(),ended_at:null,start_request_id:args.p_request_id};rows.unshift(shift);localStorage.setItem('fixture-shifts',JSON.stringify(rows));return {data:shift};
  }
  if(name==='fleet_shift_end'){const shift=rows.find(x=>x.id===args.p_shift_id);shift.ended_at=new Date().toISOString();localStorage.setItem('fixture-shifts',JSON.stringify(rows));return {data:shift};}
  return {data:[]};
 },functions:{invoke:async()=>({data:{success:true},error:null})}};
 window.supabase={createClient:()=>client};
})();`;
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FLEET_CHROMIUM_PATH?{executablePath:process.env.FLEET_CHROMIUM_PATH}:{})});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=route.request().url();
   if(new URL(url).origin===new URL(base).origin)return route.continue();
   if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});
   if(route.request().resourceType()==='script')return route.fulfill({contentType:'application/javascript',body:''});
   return route.abort();
  });
  await page.goto(base+'/');
  await page.locator('#loginIdentifier').fill('driver@example.test');await page.locator('#loginPassword').fill('synthetic-password');
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.getByRole('heading',{name:'Pronto para começar'}).waitFor();
  await page.locator('#nativeShiftQr').fill(base+'/?vehicle='+('a'.repeat(32))+'&mode=driver');
  await page.getByRole('button',{name:'Reconhecer viatura'}).click();
  await page.getByRole('heading',{name:'AA-00-AA',exact:true}).waitFor();
  const replacement=base+'/?vehicle='+('b'.repeat(32))+'&mode=driver';
  await page.locator('#nativeShiftQr').fill(replacement);
  assert.equal(await page.getByRole('button',{name:'Iniciar turno',exact:true}).count(),0,'Editing the QR must invalidate the recognized vehicle');
  assert.equal(await page.getByRole('heading',{name:'AA-00-AA',exact:true}).count(),0);
  await page.getByRole('button',{name:'Atualizar turnos',exact:true}).click();
  assert.equal(await page.locator('#nativeShiftQr').inputValue(),replacement);
  await page.getByRole('button',{name:'Reconhecer viatura'}).click();
  await page.getByRole('heading',{name:'BB-11-BB',exact:true}).waitFor();
  await page.getByRole('button',{name:'Iniciar turno',exact:true}).click();
  await page.getByRole('heading',{name:'Turno em curso'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Iniciar turno',exact:true}).count(),0);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture-shifts')).map(shift=>shift.vehicle_id)),['second-vehicle']);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>390),false);
  if(process.env.FLEET_QA_SCREENSHOT)await page.screenshot({path:process.env.FLEET_QA_SCREENSHOT,fullPage:true});
  await page.reload();await page.getByRole('heading',{name:'Turno em curso'}).waitFor();
  await page.getByRole('button',{name:'Terminar turno',exact:true}).click();
  await page.getByRole('heading',{name:'Pronto para começar'}).waitFor();
  await page.getByText('Quilómetros Cartrack por confirmar',{exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture-shifts'))[0].ended_at));
  assert.deepEqual(errors,[]);
  console.log('PASS mobile browser: login, QR lookup without fixed assignment, server-confirmed start/end, reload recovery, one session, pending mileage and no horizontal overflow');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
