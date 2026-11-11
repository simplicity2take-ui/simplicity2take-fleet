const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module'),{webcrypto}=require('node:crypto');
const code=stripTypeScriptTypes(fs.readFileSync('supabase/functions/bolt-activity-sync/index.ts','utf8').replace(/^import .*;\n/gm,''));
let handler,profile,authValid,email,pages,index,reads,writes,calls,logs,writeFailure,profileFailure;
const userId='00000000-0000-4000-8000-000000000001';
const order=id=>({order_reference:id,driver:{uuid:'driver',phone:'PRIVATE-PHONE'},vehicle:{uuid:'vehicle',registration_number:'AA-00-AA'},status:'finished',finished_datetime:'2026-11-11T10:00:00Z'});
function reset(){profile={role:'admin',status:'Ativo'};profileFailure=false;authValid=true;email='simplicity2take@gmail.com';pages=[{total:3,orders:[order('a'),order('b')]},{total:3,orders:[order('c')]}];index=0;reads=0;writes=[];calls=[];logs=[];writeFailure=false;}
const client={auth:{getUser:async()=>authValid?{data:{user:{id:userId,email}}}:{data:{},error:true}},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:profile,error:profileFailure?true:null})})})})};
class FakePool{async connect(){return {queryObject:async(...args)=>{writes.push(args);if(writeFailure)throw Error('synthetic persistence failure');return {rows:[{result:{trips_saved:3}}]};},release(){}}}}
const fetch=async(url,options)=>{calls.push({url,options});if(url.includes('oidc'))return new Response(JSON.stringify({access_token:'PRIVATE-TOKEN'}));const page=pages[Math.min(index++,pages.length-1)];return new Response(JSON.stringify({code:0,data:page}));};
vm.runInNewContext(code,{Deno:{env:{get:()=> 'PRIVATE-ENV'},serve:fn=>handler=fn},createClient:()=>client,Pool:FakePool,fetch,Request,Response,URLSearchParams,Date,Number,JSON,Set,crypto:webcrypto,AbortController,setTimeout,clearTimeout,console:{info:s=>logs.push(JSON.parse(s)),error:s=>logs.push(JSON.parse(s))}});
const request=(method='POST',bearer=true)=>({method,headers:new Headers(bearer?{Authorization:'Bearer fixture'}:{}),json:async()=>{reads++;return {days:28,company_id:123};}});
(async()=>{
 reset();assert.equal((await handler(request('OPTIONS',false))).status,200);assert.equal(reads,0);
 reset();assert.equal((await handler(request('GET'))).status,405);assert.equal(calls.length,0);
 reset();assert.equal((await handler(request('POST',false))).status,401);assert.equal(reads,0);
 reset();authValid=false;assert.equal((await handler(request())).status,401);assert.equal(reads,0);
 reset();email='someone@example.test';assert.equal((await handler(request())).status,403);assert.equal(reads,0);
 for(const denied of [{role:'driver',status:'Ativo'},{role:'admin',status:'Inativo'},null]){reset();profile=denied;assert.equal((await handler(request())).status,403);assert.equal(reads,0);assert.equal(writes.length,0);assert.equal(calls.length,0);}
 reset();profileFailure=true;assert.equal((await handler(request())).status,403);assert.equal(calls.length,0);assert.equal(writes.length,0);
 reset();const result=await (await handler(request())).json();assert.equal(result.ok,true);assert.equal(result.tripsReceived,3);assert.equal(writes.length,1);assert.equal(index,2);
 const requests=calls.slice(1).map(x=>JSON.parse(x.options.body));assert.deepEqual(requests.map(x=>x.offset),[0,2]);assert.ok(requests.every(x=>x.company_id===9360));
 const succeeded=logs.at(-1);assert.equal(succeeded.event,'platform_report_import_succeeded');assert.equal(succeeded.coverage_verified,false);assert.equal(succeeded.api_pagination_complete,true);assert.equal(succeeded.snapshot_consistency_unverified,true);assert.equal(succeeded.page_count,2);assert.equal(succeeded.received_rows,3);assert.equal(succeeded.request_id,logs[0].request_id);
 for(const privateValue of ['PRIVATE-PHONE','PRIVATE-TOKEN','PRIVATE-ENV','AA-00-AA'])assert.ok(!JSON.stringify(logs).includes(privateValue));
 const failures=[
 [{total:3,orders:[order('a'),order('b')]},{total:3,orders:[order('b')]}],
 [{total:3,orders:[order('a'),order('b')]},{total:4,orders:[order('c')]}],
 [{total:3,orders:[order('a')]},{total:3,orders:[]}],
 [{total:1,orders:[order('a'),order('b')]}],
 [{total:1,orders:[order(' ')]}],
 [{total:'1',orders:[order('a')]}],
 Array.from({length:100},(_,i)=>({total:101,orders:[order(String(i))]}))
 ];
 for(const fixture of failures){reset();pages=fixture;assert.equal((await handler(request())).status,502);assert.equal(writes.length,0);assert.equal(logs.at(-1).event,'platform_report_import_failed');assert.equal(logs.at(-1).data_write_attempted,false);assert.equal(logs.at(-1).coverage_verified,false);}
 reset();writeFailure=true;assert.equal((await handler(request())).status,502);assert.equal(logs.at(-1).event,'platform_report_import_failed');assert.equal(logs.at(-1).data_write_attempted,true);
 reset();pages=[{total:0,orders:[]}];assert.equal((await (await handler(request())).json()).ok,true);assert.equal(logs.at(-1).expected_total,0);assert.equal(logs.at(-1).coverage_verified,false);
 console.log('PASS Bolt import: active-admin guard before reads/OAuth, complete pagination, stable total, no duplicates/overrun/gaps/page-cap writes, safe trace and no inferred absence coverage');
})().catch(e=>{console.error(e);process.exitCode=1});
