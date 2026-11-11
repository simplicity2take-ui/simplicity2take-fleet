const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
(async()=>{
 let handler,allow=true,writes=[],historyFails=false,historyPartial=false,queueCalls=0,staleWrite=false;
 const shift={id:'s',driver_id:'d',vehicle_id:'v',driver_name:'Synthetic driver',vehicle_plate:'AA-00-AA',started_at:'2026-11-10T08:00:00Z',ended_at:'2026-11-10T16:00:00Z'};
 const trip={platform:'uber',source_trip_id:'t',driver_id:'d',vehicle_id:'v',accepted_at:'2026-11-10T10:00:00Z',finished_at:'2026-11-10T11:00:00Z'};
 const db={rpc:async()=>({data:allow,error:null}),from:table=>{
   let update=null;
   const q={select(){return q},or(){return q},in(){return q},lte(){return q},order(){return q},limit(){return q},range(){return q},eq(){return q},is(){return q},single(){return q},update(value){update=value;return q},
   then(resolve,reject){try{if(update){writes.push(update);return Promise.resolve({error:null,data:staleWrite?[]:[{id:shift.id}]}).then(resolve,reject)}if(table==='driver_shift_sessions'){queueCalls++;return Promise.resolve({data:[shift],error:null}).then(resolve,reject)}return Promise.resolve({data:table==='drivers'?{id:'d',uber_driver_uuid:'u'}:[trip],count:1,error:null}).then(resolve,reject)}catch(e){return Promise.reject(e).then(resolve,reject)}}};
   return q;
 }};
 const context={console,Request,Response,AbortSignal,Date,Number,JSON,Set,Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://synthetic.example.test':'fixture'},serve:fn=>handler=fn},createClient:()=>db,fetch:async(url,options)=>{
   assert.equal(url,'https://synthetic.example.test/functions/v1/cartrack-history');
   assert.equal(options.headers['x-cartrack-sync-key'],'scoped-test-key');
   if(historyFails)return new Response('{}',{status:502});
   return new Response(JSON.stringify({success:true,trips:[{id:1,registration:'AA-00-AA',start:'2026-11-10T08:00:00Z',end:'2026-11-10T16:00:00Z',startOdometerKm:1000,endOdometerKm:1120}],meta:{last_page:historyPartial?99:1,total:historyPartial?999:1}}));
 }};
 vm.createContext(context);
 for(const path of ['native-shifts.js','shift-mileage.js'])vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'..',path),'utf8'),context);
 const source=fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/shift-review/index.ts'),'utf8').replace(/^import .*;\n/gm,'');
 vm.runInContext(stripTypeScriptTypes(source),context);
 const call=key=>handler(new Request('https://synthetic.example.test/shift-review',{method:'POST',headers:key?{'x-cartrack-sync-key':key}:{}}));
 assert.equal((await call()).status,401);assert.equal(queueCalls,0);
 allow=false;assert.equal((await call('bad')).status,403);assert.equal(queueCalls,0);
 allow=true;assert.equal((await call('scoped-test-key')).status,200);
 assert.equal(writes.at(-1).cartrack_review.distance,120);
 assert.equal(writes.at(-1).cartrack_review.source,'cartrack');
 assert.equal(writes.at(-1).trip_review.state,'checked_available_data');
 assert.ok(writes.at(-1).trip_review.flags.includes('platform_coverage_unconfirmed'));
 const verified=structuredClone(writes.at(-1).cartrack_review);
 for(const payload of writes)assert.deepEqual(Object.keys(payload).sort(),['cartrack_review','next_review_at','reviewed_at','trip_review']);
 historyFails=true;assert.equal((await call('scoped-test-key')).status,200);assert.equal(writes.at(-1).cartrack_review.state,'pending');
 historyFails=false;historyPartial=true;assert.equal((await call('scoped-test-key')).status,200);assert.equal(writes.at(-1).cartrack_review.distance,null);
 shift.cartrack_review=verified;historyFails=true;historyPartial=false;
 assert.equal((await call('scoped-test-key')).status,200);assert.equal(writes.at(-1).cartrack_review.distance,120);
 assert.equal(writes.at(-1).cartrack_review.refresh_state,'pending');assert.equal(writes.at(-1).cartrack_review.confirmed_at,verified.confirmed_at);
 historyFails=false;staleWrite=true;
 const skipped=await (await call('scoped-test-key')).json();assert.equal(skipped.reviewed,0);assert.equal(skipped.skipped,1);
 console.log('PASS automatic review worker: scoped authentication, trip checks, Cartrack-only mileage, unavailable/partial history and no declared-shift changes');
})().catch(e=>{console.error(e);process.exitCode=1});
