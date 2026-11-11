const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/cartrack-history/index.ts','utf8').replace(/^import .*;\n/gm,''));
let handler;
const client={auth:{getUser:async()=>({data:{user:{id:'test'}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role:'admin',status:'Ativo'}})})})})};
vm.runInNewContext(source,{Deno:{env:{get:()=> 'fixture'},serve:fn=>handler=fn},createClient:()=>client,Request,Response,URLSearchParams,AbortSignal,Date,Number,JSON,btoa,fetch:async()=>new Response(JSON.stringify({data:[{trip_id:1,registration:'AA-00-AA',start_odometer:123456000,end_odometer:123789500,start_coordinates:{latitude:1,longitude:2},start_location:'PRIVATE ADDRESS'},{trip_id:2,registration:'BB-00-BB',start_odometer:null,end_odometer:-1},{trip_id:3,registration:'CC-00-CC',start_odometer:'123',end_odometer:false}],meta:{last_page:1}}))});
(async()=>{
 const response=await handler(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({start:'2026-11-09T00:00:00Z',end:'2026-11-10T00:00:00Z'})}));
 const result=await response.json();assert.equal(result.trips[0].startOdometerKm,123456);assert.equal(result.trips[0].endOdometerKm,123789.5);
 for(const trip of result.trips.slice(1)){assert.equal(trip.startOdometerKm,null);assert.equal(trip.endOdometerKm,null);}
 assert.ok(!JSON.stringify(result).includes('PRIVATE ADDRESS'));assert.ok(!JSON.stringify(result).includes('latitude'));
 console.log('PASS confirmed meter-to-km conversion, invalid/missing-value handling and response allowlist without positions or addresses');
})().catch(error=>{console.error(error);process.exitCode=1});
