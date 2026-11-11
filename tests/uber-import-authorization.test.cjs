const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module'),{webcrypto}=require('node:crypto');
const code=stripTypeScriptTypes(fs.readFileSync('supabase/functions/uber-report-import/index.ts','utf8').replace(/^import .*;\n/gm,''));
let handler,calls,logs,bodyReads,profile,authValid,profileFailure,writeFailure;
const fixtureUser='00000000-0000-4000-8000-000000000001';
const sourceCsv='UUID do motorista,Nome do motorista,Estado,E-mail do motorista\ndriver-uuid,Private Person,ACTIVE,private@example.test';
function reset(){calls=[];logs=[];bodyReads=0;profile={role:'admin',status:'Ativo'};authValid=true;profileFailure=false;writeFailure=false;}
const fetch=async(url,options={})=>{
 calls.push({url,method:options.method||'GET',body:options.body});
 if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:fixtureUser,user_metadata:{role:'admin'}}),{status:authValid?200:401});
 if(url.includes('/profiles?'))return new Response(JSON.stringify(profile?[profile]:[]),{status:profileFailure?500:200});
 if(url.includes('/drivers?'))return new Response('[]');
 if(url.includes('/rpc/'))return new Response(writeFailure?'failure':'{}',{status:writeFailure?500:200});
 throw Error('Unexpected network access: '+url);
};
vm.runInNewContext(code,{Deno:{env:{get:()=> 'test-only'},serve:fn=>handler=fn},fetch,Request,Response,Headers,URL,Date,TextEncoder,Uint8Array,crypto:webcrypto,console:{info:s=>logs.push(JSON.parse(s)),error(){}},Number,Array,JSON,Map,Set});
const request=(query='type=status',method='POST',bearer=true,csv=sourceCsv)=>({method,url:'https://fixture.test/?'+query,headers:new Headers(bearer?{Authorization:'Bearer test-user'}:{}),text:async()=>{bodyReads++;return csv}});
const writes=()=>calls.filter(c=>c.method==='POST');
(async()=>{
 reset();assert.equal((await handler(request('', 'OPTIONS',false))).status,204);assert.equal(calls.length,0);
 reset();assert.equal((await handler(request('', 'GET'))).status,405);assert.equal(calls.length,0);
 reset();assert.equal((await handler(request('type=status','POST',false))).status,401);assert.equal(calls.length,0);
 reset();authValid=false;assert.equal((await handler(request())).status,401);assert.equal(bodyReads,0);
 for(const rejected of [{role:'driver',status:'Ativo'},{role:'admin',status:'Inativo'},null]){
  reset();profile=rejected;const response=await handler(request());assert.equal(response.status,403);assert.equal(bodyReads,0);assert.equal(writes().length,0);assert.equal(logs.length,0);
 }
 reset();profileFailure=true;assert.equal((await handler(request())).status,400);assert.equal(bodyReads,0);assert.equal(writes().length,0);
 for(const query of ['type=activity','type=activity&period_start=2026-02-30&period_end=2026-03-01','type=activity&period_start=2026-11-10&period_end=2026-11-09','type=activity&dry_run=true','type=status&dry_run=maybe']){
  reset();assert.equal((await handler(request(query))).status,400);assert.equal(writes().length,0);assert.equal(bodyReads,0);
 }
 reset();const preview=await (await handler(request('type=status&dry_run=true'))).json();assert.equal(preview.dry_run,true);assert.equal(writes().length,0);assert.equal(logs.length,0);
 reset();const success=await (await handler(request())).json();assert.equal(success.ok,true);assert.equal(writes().length,1);assert.equal(logs.length,2);
 assert.equal(logs[0].event,'platform_report_import_started');assert.equal(logs[1].event,'platform_report_import_succeeded');assert.equal(logs[1].received_rows,1);assert.equal(logs[1].coverage_verified,false);assert.equal(logs[1].actor_id,fixtureUser);assert.match(logs[1].source_sha256,/^[a-f0-9]{64}$/);
 assert.equal(logs[0].request_id,logs[1].request_id);for(const privateValue of ['Private Person','private@example.test','Bearer','test-only'])assert.ok(!JSON.stringify(logs).includes(privateValue));
 reset();writeFailure=true;assert.equal((await handler(request())).status,400);assert.equal(logs.at(-1).event,'platform_report_import_failed');assert.equal(logs.at(-1).coverage_verified,false);
 reset();assert.equal((await handler(request('type=status','POST',true,'"unclosed'))).status,400);assert.equal(writes().length,0);assert.equal(logs.at(-1).event,'platform_report_import_failed');
 console.log('PASS Uber import: active-admin authorization before body/write, method/period guards, safe previews, trace hashes, failures and no asserted coverage or private CSV logs');
})().catch(e=>{console.error(e);process.exitCode=1});
