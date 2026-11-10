const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
let handler,calls=[];
const client={auth:{getUser:async()=>({data:{user:{id:'fixture'}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role:'admin',status:'Ativo'}})})})})};
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/bolt-online-read/index.ts','utf8').replace(/^import .*;\n/gm,''));
vm.runInNewContext(source,{Deno:{env:{get:()=> 'fixture-secret'},serve:fn=>handler=fn},createClient:()=>client,Request,Response,URLSearchParams,AbortSignal,Date,Number,JSON,fetch:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.includes('oidc')?{access_token:'fixture-token'}:{code:0,data:{total:1001,orders:[{order_reference:'1',driver:{uuid:'d',first_name:'Example',last_name:'Driver',phone:'private'},vehicle:{registration_number:'AA-00-AA'},stops:[{address:'private'}],status:'finished',driver_accepted_datetime:'2026-10-10T09:00:00Z',finished_datetime:'2026-10-10T09:20:00Z'}]}}));}});
const request=body=>new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify(body)});
(async()=>{
 for(const body of [{mode:'rides'},{mode:'rides',start:'2026-01-01T00:00:00Z',end:'2026-03-01T00:00:00Z'},{mode:'rides',start:'2026-10-10T00:00:00Z',end:'2026-10-11T00:00:00Z',offset:-1}])assert.equal((await handler(request(body))).status,400);
 assert.equal(calls.length,0);
 const data=await (await handler(request({mode:'rides',start:'2026-10-10T00:00:00Z',end:'2026-10-11T00:00:00Z',offset:1000,company_id:1}))).json();
 assert.equal(data.ok,true);assert.equal(data.rides[0].plate,'AA-00-AA');assert.equal(data.rides[0].pickupAt,null);assert.equal(data.nextOffset,null);assert.equal(data.total,1001);
 const sent=JSON.parse(calls[1].options.body);assert.equal(sent.company_id,9360);assert.equal(sent.offset,1000);assert.equal(sent.limit,1000);assert.equal(sent.start_datetime,'2026-10-10T00:00:00+00:00');assert.equal(sent.end_datetime,'2026-10-11T00:00:00+00:00');assert(calls[1].url.endsWith('/getRideHistory'));
 for(const text of ['private','fixture-secret','fixture-token','stops'])assert(!JSON.stringify(data).includes(text));
 console.log('PASS ride range validation before OAuth, V2 pagination, fixed company, missing times and data minimization');
})().catch(e=>{console.error(e);process.exitCode=1});
