const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/bolt-online-read/index.ts','utf8').replace(/^import .*;\n/gm,''));
let handler,role='admin',status='Ativo',code=0,calls=[];
const client={auth:{getUser:async()=>({data:{user:{id:'fixture'}},error:null})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role,status}})})})})};
vm.runInNewContext(source,{Deno:{env:{get:()=> 'fixture-server-secret'},serve:fn=>handler=fn},createClient:()=>client,Request,Response,URLSearchParams,AbortSignal,Date,Number,JSON,fetch:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.includes('oidc')?{access_token:'fixture-bolt-token'}:{code,data:{drivers:[{uuid:'driver',first_name:'Example',last_name:'Driver',email:'private@example.test',phone:'private',current_location:{lat:1,lng:2},vehicle:{uuid:'vehicle',registration_number:'AA-00-AA'},current_state:{code:'waiting',changed_at:'2026-11-10T08:00:00Z'},current_order:{private:'not returned'}}]}}),{status:200});}});
const req=(auth=true)=>new Request('https://example.test',{method:'POST',headers:auth?{Authorization:'Bearer fixture'}:{},body:JSON.stringify({company_id:999})});
(async()=>{
 assert.equal((await handler(req(false))).status,401);assert.equal(calls.length,0);
 role='driver';assert.equal((await handler(req())).status,403);assert.equal(calls.length,0);
 role='admin';status='Inativo';assert.equal((await handler(req())).status,403);assert.equal(calls.length,0);
 status='Ativo';let response=await handler(req()),data=await response.json();assert.equal(data.ok,true);assert.equal(data.drivers[0].plate,'AA-00-AA');assert.equal(data.drivers[0].stateChangedAt,'2026-11-10T08:00:00.000Z');assert.equal(JSON.parse(calls[1].options.body).company_id,9360);assert(calls[1].url.endsWith('/fleet-integration-gateway-v2/fleetIntegration/v2/getOnlineDrivers'));assert(!JSON.stringify(data).includes('private'));assert(!JSON.stringify(data).includes('fixture-server-secret'));assert(!JSON.stringify(data).includes('fixture-bolt-token'));assert(!('usageStartedAt' in data.drivers[0]));
 code=498813;data=await (await handler(req())).json();assert.equal(data.ok,false);assert.equal(data.code,498813);assert(!('drivers' in data));
 console.log('PASS anonymous/driver/inactive-admin rejection, fixed company/v2 endpoint, whitelisted data only, no inferred vehicle-change time and HTTP-200 API errors.');
})().catch(e=>{console.error(e);process.exitCode=1});
