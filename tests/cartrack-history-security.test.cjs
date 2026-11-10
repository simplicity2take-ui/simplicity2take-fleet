const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/cartrack-history/index.ts','utf8').replace(/^import .*;\n/gm,''));
let handler,fetchCount=0,role='admin',upstreamStatus=200,lastUrl;
const client={auth:{getUser:async()=>({data:{user:{id:'admin'}},error:null})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role,status:'Ativo'}})})})}),rpc:async()=>({data:false})};
vm.runInNewContext(source,{Deno:{env:{get:key=>key==='CARTRACK_USERNAME'?'test-user':key==='CARTRACK_PASSWORD'?'test-password':'fixture'},serve:fn=>handler=fn},createClient:()=>client,Request,Response,URLSearchParams,AbortSignal,Date,Number,JSON,btoa,fetch:async url=>{fetchCount++;lastUrl=url;return new Response(JSON.stringify({data:[],meta:{last_page:1}}),{status:upstreamStatus});}});
const request=(body={},headers={Authorization:'Bearer fixture'})=>new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
(async()=>{
 assert.equal((await handler(request({},{}))).status,401);assert.equal(fetchCount,0);
 role='driver';assert.equal((await handler(request())).status,403);assert.equal(fetchCount,0);
 role='admin';assert.equal((await handler(request({start:'invalid'}))).status,400);assert.equal(fetchCount,0);
 assert.equal((await handler(request({start:'2026-01-01T00:00:00Z',end:'2026-03-01T00:00:00Z'}))).status,400);
 const result=await handler(request({start:'2026-11-09T00:00:00Z',end:'2026-11-10T00:00:00Z',page:2}));assert.equal(result.status,200);const url=new URL(lastUrl);assert.equal(url.searchParams.get('page'),'2');assert.equal(url.searchParams.get('start_timestamp'),'2026-11-09 00:00:00');assert.equal(url.searchParams.get('incl_private'),'false');assert.equal((await result.json()).success,true);
 upstreamStatus=403;assert.equal((await handler(request())).status,502);
 console.log('PASS anonymous/driver rejection before upstream access, date validation, UTC request format, pagination and upstream failure.');
})().catch(e=>{console.error(e);process.exitCode=1});
