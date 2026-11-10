const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('uber-activity-view.js','utf8');
const now=Date.parse('2026-11-10T14:00:00Z');
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
function fixture({role='Administrador',hidden=false,error=false,deferred=false,multiple=false}={}){
 const f={role,hidden,title:'Utilização da Frota',panel:null,calls:[],pending:[]};
 const rows={drivers:[{id:'old',full_name:'OLD',uber_status:'ONLINE',uber_status_at:'2026-10-20T15:58:31Z'},{id:'fresh',full_name:'FRESH',uber_status:'ONTRIP',uber_status_at:'2026-11-10T13:59:00Z'},{id:'unknown',full_name:'UNKNOWN',uber_status:null}],vehicles:[{id:'one',plate:'AA-00-AA'},{id:'two',plate:'BB-00-BB'}],vehicle_assignments:[{vehicle_id:'one',driver_id:'old'},{vehicle_id:'two',driver_id:'fresh'}]};
 if(multiple) rows.vehicle_assignments.push({vehicle_id:'one',driver_id:'fresh'},{vehicle_id:'one',driver_id:'fresh'},{vehicle_id:'one',driver_id:'unknown',active_from:'2026-11-11'},{vehicle_id:'two',driver_id:'old',active_until:'2026-11-09'});
 const client={auth:{onAuthStateChange:fn=>f.auth=fn},from:table=>({select:()=>{f.calls.push(table);const result={data:rows[table],error:error?new Error('fixture error'):null};return deferred?new Promise(resolve=>f.pending.push(()=>resolve(result))):Promise.resolve(result);}})};
 const document={body:{},querySelector:selector=>selector==='#pageTitle'?{textContent:f.title}:selector==='#sessionRole'?{textContent:f.role}:selector==='#appShell'?{classList:{contains:()=>f.hidden}}:selector==='#s2tUberActivityPanel'?f.panel:selector==='#content'?{appendChild:panel=>f.panel=panel}:null,createElement:()=>({style:{},innerHTML:'',remove(){if(f.panel===this)f.panel=null;}})};
 vm.runInNewContext(source,{Date:Clock,Intl,Number,Map,Promise,window:{supabase:{createClient:()=>client},addEventListener:(name,fn)=>{if(name==='load')f.load=fn;}},document,MutationObserver:class{constructor(fn){f.mutate=fn;}observe(){}},console:{error:()=>{}}});
 return f;
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 let f=fixture();f.load();await settle();assert(f.panel);const html=f.panel.innerHTML;
 assert(html.includes('Últimos estados Uber dos motoristas'));assert(html.includes('20/10/2026'));assert(html.includes('Estado antigo ou sem data'));assert(html.includes('1 estados antigos ou sem data'));assert(html.includes('Data do estado (Lisboa)'));assert(!html.includes('Agora'));assert(!html.includes('NaN'));assert(!html.includes('s2tCartrackKm'));assert.deepEqual(f.calls.sort(),['drivers']);f.mutate();await settle();assert.equal(f.calls.length,1);
 f=fixture({multiple:true});f.load();await settle();const multi=f.panel.innerHTML;assert(!multi.includes('AA-00-AA'));assert(!multi.includes('BB-00-BB'));assert.equal((multi.match(/>OLD<\/td>/g)||[]).length,1);assert.equal((multi.match(/>FRESH<\/td>/g)||[]).length,1);assert.equal((multi.match(/>UNKNOWN<\/td>/g)||[]).length,1);assert(multi.includes('Estar online não confirma circulação'));assert.deepEqual(f.calls,['drivers']);
 f=fixture({role:'Motorista'});f.load();await settle();assert.equal(f.calls.length,0);assert.equal(f.panel,null);
 f=fixture({hidden:true});f.load();await settle();assert.equal(f.calls.length,0);
 f=fixture({error:true});f.load();await settle();assert(f.panel.textContent.includes('Não foi possível'));assert(!f.panel.innerHTML.includes('metric-card'));
 f=fixture({deferred:true});f.load();f.hidden=true;f.auth('SIGNED_OUT');f.pending.forEach(resolve=>resolve());await settle();assert.equal(f.panel,null);
 f=fixture({deferred:true});f.load();f.title='Veículos';f.pending.forEach(resolve=>resolve());await settle();assert.equal(f.panel,null);
 console.log('PASS recorded dates, stale warnings, no live-now claim, no duplicate Cartrack metric/query, no duplicate requests, one row per driver without inferring vehicle usage from assignments, admin-only visibility, failed query notice and stale logout/navigation responses.');
})().catch(e=>{console.error(e);process.exitCode=1});
