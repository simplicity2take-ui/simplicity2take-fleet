const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
(async()=>{
 let handler,allow=true,writes=[],historyFails=false,historyPartial=false,queueCalls=0,staleWrite=false;
 const shift={id:'s',driver_id:'d',vehicle_id:'v',driver_name:'Synthetic driver',vehicle_plate:'AA-00-AA',started_at:'2026-11-10T08:00:00Z',ended_at:'2026-11-10T16:00:00Z'};
 const trip={order_status:'completed',id:'row-1',platform:'uber',source_trip_id:'t',driver_id:'d',vehicle_id:'v',accepted_at:'2026-11-10T10:00:00Z',finished_at:'2026-11-10T11:00:00Z'};
 let tripPage = () => ({data:[trip],count:1,error:null});
 let historyPage;
 const db={rpc:async()=>({data:allow,error:null}),from:table=>{
   let update=null,offset=0, timeFilter, statusFilter;
   const q={select(){return q},or(value){timeFilter=value;return q},in(){return q},lte(){return q},order(){return q},limit(){return q},range(from){offset=from;return q},eq(field,value){if(field==='order_status')statusFilter=value;return q},is(){return q},single(){return q},update(value){update=value;return q},
   then(resolve,reject){try{if(update){writes.push(update);return Promise.resolve({error:null,data:staleWrite?[]:[{id:shift.id}]}).then(resolve,reject)}if(table==='platform_trip_records')return Promise.resolve(tripPage(offset,timeFilter,statusFilter)).then(resolve,reject);if(table==='driver_shift_sessions'){queueCalls++;return Promise.resolve({data:[shift],error:null}).then(resolve,reject)}return Promise.resolve({data:table==='drivers'?{id:'d',uber_driver_uuid:'u'}:[trip],count:1,error:null}).then(resolve,reject)}catch(e){return Promise.reject(e).then(resolve,reject)}}};
   return q;
 }};
 const context={console,Request,Response,AbortSignal,Date,Number,JSON,Set,Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://synthetic.example.test':'fixture'},serve:fn=>handler=fn},createClient:()=>db,fetch:async(url,options)=>{
   assert.equal(url,'https://synthetic.example.test/functions/v1/cartrack-history');
   assert.equal(options.headers['x-cartrack-sync-key'],'scoped-test-key');
   if(historyFails)return new Response('{}',{status:502});
   if(historyPage)return Response.json(historyPage(JSON.parse(options.body).page));
   return new Response(JSON.stringify({success:true,trips:[{id:1,registration:'AA-00-AA',start:'2026-11-10T08:00:00Z',end:'2026-11-10T16:00:00Z',startOdometerKm:1000,endOdometerKm:1120}],meta:{last_page:historyPartial?99:1,total:historyPartial?999:1}}));
 }};
 vm.createContext(context);
 for(const path of ['supabase/functions/shift-review/native-shifts.js','supabase/functions/shift-review/shift-mileage.js'])vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'..',path),'utf8'),context);
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
 // Evaluate the time and status conditions sent to the database using synthetic records.
 function filteredPage(records) {
   return (_offset, filter, status) => {
     assert.equal(status,'completed');
     const intervals = Array.from(filter.matchAll(/and\(([^,()]+),([^,()]+)\)/g), match => match.slice(1,3));
     const rows = records.filter(row => row.order_status === status && intervals.some(conditions =>
       conditions.every(condition => {
         const [,field,op,value] = /^(\w+)\.(gte|lte)\.(.+)$/.exec(condition);
         if (!row[field]) return false;
         return op === 'gte' ? Date.parse(row[field]) >= Date.parse(value) : Date.parse(row[field]) <= Date.parse(value);
       })
     ));
     return {data:rows,count:rows.length,error:null};
   };
 }
 const cancelled={...trip,order_status:'rider_cancelled'};
 tripPage=filteredPage([cancelled]);
 assert.equal((await call('scoped-test-key')).status,200);
 assert.equal(writes.at(-1).trip_review.state,'pending');
 assert.equal(writes.at(-1).trip_review.counts.uber,0);
 for (const [opening,closing] of [['accepted_at','dropoff_at'],['pickup_at','finished_at']]) {
   const spanning={...trip,accepted_at:null,finished_at:null,[opening]:'2026-11-10T07:30:00Z',[closing]:'2026-11-10T16:30:00Z'};
   tripPage=filteredPage([spanning,cancelled]);
   assert.equal((await call('scoped-test-key')).status,200);
   const review=writes.at(-1).trip_review;
   assert.equal(review.state,'review',opening+' to '+closing);
   assert.equal(review.counts.uber,1);
   assert.ok(review.flags.includes('trip_crosses_shift_boundary'));
 }
 tripPage=()=>({data:[trip],count:1,error:null});
 const odometers={registration:'AA-00-AA',start:shift.started_at,end:shift.ended_at,startOdometerKm:1000,endOdometerKm:1120};
 for(const [label, firstMeta, secondMeta, secondId, distance] of [
   ['stable',{last_page:2,total:2},{last_page:2,total:2},2,120],
   ['optional total',{last_page:'2'},{last_page:'2'},2,120],
   ['shrinking total',{last_page:2,total:3},{last_page:2,total:2},2,null],
   ['shrinking last page',{last_page:3},{last_page:2},2,null],
   ['wrong page',{last_page:2},{last_page:2,current_page:1},2,null],
   ['missing ID',{last_page:2},{last_page:2},null,null],
   ['duplicate ID',{last_page:2},{last_page:2},'1',null],
 ]) {
   historyPage=page=>({success:true,trips:[{...odometers,id:page===1?1:secondId}],meta:page===1?firstMeta:secondMeta});
   assert.equal((await call('scoped-test-key')).status,200,label);
   assert.equal(writes.at(-1).cartrack_review.distance,distance,label);
   if(distance===null)assert.equal(writes.at(-1).cartrack_review.reason,'partial_history',label);
 }
 historyPage=null;
 const secondTrip={...trip,id:'row-2',source_trip_id:'t2'};
 for (const [label, firstTotal, lastTotal, lastRow, partial] of [
   ['stable',2,2,secondTrip,false],
   ['changed',3,2,secondTrip,true],
   ['missing initial total',null,2,secondTrip,true],
   ['missing final total',2,null,secondTrip,true],
   ['repeated row',2,2,trip,true],
   ['missing row ID',2,2,{...secondTrip,id:null},true],
   ['short result',2,2,null,true],
 ]) {
   tripPage=offset=>({data:offset===0?[trip]:lastRow?[lastRow]:[],count:offset===0?firstTotal:lastTotal,error:null});
   assert.equal((await call('scoped-test-key')).status,200);
   const review=writes.at(-1).trip_review;
   assert.equal(review.state,partial?'pending':'checked_available_data',label);
   assert.equal(review.flags.includes('partial_trip_history'),partial,label);
   if(!partial)assert.equal(review.counts.uber,2,label);
 }
 for (const id of [trip.id, null]) {
   const offsets=[];
   const invalid={...secondTrip,id,source_trip_id:'unconfirmed'};
   tripPage=offset=>{
     offsets.push(offset);
     return {data:offset===0?[trip,invalid]:offset===2?[{...secondTrip,platform:'bolt'}]:[],count:3,error:null};
   };
   assert.equal((await call('scoped-test-key')).status,200);
   const review=writes.at(-1).trip_review;
   assert.deepEqual(offsets,[0,2]);
   assert.equal(review.state,'pending');
   assert.equal(review.counts.uber,1);
   assert.equal(review.counts.bolt,1);
   assert.ok(review.flags.includes('partial_trip_history'));
 }
 tripPage=()=>({data:[trip],count:1,error:null});
 historyFails=true;assert.equal((await call('scoped-test-key')).status,200);assert.equal(writes.at(-1).cartrack_review.state,'pending');
 historyFails=false;historyPartial=true;assert.equal((await call('scoped-test-key')).status,200);assert.equal(writes.at(-1).cartrack_review.distance,null);
 shift.cartrack_review=verified;historyFails=true;historyPartial=false;
 assert.equal((await call('scoped-test-key')).status,200);assert.equal(writes.at(-1).cartrack_review.distance,120);
 assert.equal(writes.at(-1).cartrack_review.refresh_state,'pending');assert.equal(writes.at(-1).cartrack_review.confirmed_at,verified.confirmed_at);
 historyFails=false;staleWrite=true;
 const skipped=await (await call('scoped-test-key')).json();assert.equal(skipped.reviewed,0);assert.equal(skipped.skipped,1);
 console.log('PASS automatic review worker: scoped authentication, trip checks, Cartrack-only mileage, unavailable/partial history and no declared-shift changes');
})().catch(e=>{console.error(e);process.exitCode=1});
