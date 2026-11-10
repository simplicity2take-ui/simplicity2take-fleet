const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
(async()=>{
 let handler,emails=[],rows=[{phone:'+351912345678',email:'driver@example.test'}];
 const context={Request,Response,console,Deno:{serve:fn=>handler=fn,env:{get:()=> 'test'}},createClient:()=>({from:()=>({select:()=>({eq:async()=>({data:rows})})})}),fetch:async(url,options)=>{emails.push(JSON.parse(options.body).email);return new Response(JSON.stringify({access_token:'test-token',refresh_token:'test-refresh'}));}};
 vm.createContext(context);
 const s=fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/driver-login/index.ts'),'utf8').replace(/^import .*;\n/,'');
 vm.runInContext(stripTypeScriptTypes(s),context);
 for(const phone of ['912345678','+351912345678','00351912345678','351912345678','912 345 678']){
  const r=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify({phone,password:'synthetic'})}));assert.equal(r.status,200);
 }
 assert.deepEqual(emails,Array(5).fill('driver@example.test'));
 rows=[{phone:'912345678',email:'one@example.test'},{phone:'+351912345678',email:'two@example.test'}];emails=[];
 let r=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify({phone:'912345678',password:'synthetic'})}));assert.equal(r.status,401);assert.equal(emails.length,0);
 assert.equal(context.normalizePhone('+447123456789'),'+447123456789');
 assert.equal(context.normalizePhone('00447123456789'),'+447123456789');
 console.log('PASS: Portuguese phone formats map to the same account; duplicates denied before authentication; international prefixes preserved.');
})().catch(e=>{console.error(e);process.exitCode=1});
