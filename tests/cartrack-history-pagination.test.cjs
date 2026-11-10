const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const CartrackIgnition=require('../cartrack-ignition.js');
function setup(file,invoke){
 const source=fs.readFileSync(file,'utf8');let renders=0;
 const c={Date,Number,Math,CartrackIgnition,state:{profile:{role:'admin'},sessionUserId:'admin',activeView:'activity'},document:{querySelector:()=>({value:'BJ57'})},escapeHtml:x=>String(x),renderActivity:()=>renders++,boltActivitySummary:()=>({range:{start:Date.parse('2026-11-09T00:00:00Z'),end:Date.parse('2026-11-10T00:00:00Z')}}),supabaseClient:{functions:{invoke}}};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function localDay('),source.indexOf('function activityReportRange(')),c);
 vm.runInContext(source.slice(source.indexOf('function renderCartrackIgnitionHistory('),source.indexOf('function renderActivity(')),c);
 return c;
}
const reply=(id,lastPage=1)=>({data:{success:true,trips:[{id,registration:'BJ-57-AN',start:'2026-11-09 12:00:00+00',end:'2026-11-09 13:00:00+00'}],meta:{last_page:lastPage}}});
(async()=>{for(const file of ['app.js','teste/app.js']){
 let requests=[];
 let c=setup(file,async(name,{body})=>{requests.push(body);return reply(body.page,3)});
 await c.loadCartrackIgnitionHistory();assert.deepEqual(requests.map(r=>r.page),[1,2,3]);assert.equal(c.state.cartrackIgnitionHistory.trips.length,3);assert.equal(c.state.cartrackIgnitionHistory.partial,false);assert(requests.every(r=>r.start===requests[0].start&&r.end===requests[0].end));
 requests=[];c=setup(file,async(name,{body})=>{requests.push(body);return reply(body.page,20)});await c.loadCartrackIgnitionHistory();assert.equal(requests.length,10);assert.equal(c.state.cartrackIgnitionHistory.partial,true);assert(c.renderCartrackIgnitionHistory().includes('Resultado parcial'));assert(c.renderCartrackIgnitionHistory().includes('Total parcial'));
 c=setup(file,async(name,{body})=>body.page===1?reply(1,2):{error:new Error('Network failure')});await c.loadCartrackIgnitionHistory();assert(c.state.cartrackIgnitionHistory.error);assert.equal(c.state.cartrackIgnitionHistory.trips,undefined);
 let pending=[];c=setup(file,()=>new Promise(resolve=>pending.push(resolve)));
 const old=c.loadCartrackIgnitionHistory();c.state.cartrackIgnitionHistory=null;c.state.activityWeek='previous';const recent=c.loadCartrackIgnitionHistory();assert.equal(pending.length,2);pending[1](reply('new'));await recent;pending[0](reply('old'));await old;assert.equal(c.state.cartrackIgnitionHistory.trips[0].id,'new');
 c.state.cartrackIgnitionHistory={range:{start:Date.parse('2026-11-09T00:00:00Z'),end:Date.parse('2026-11-10T00:00:00Z')},trips:[reply(1).data.trips[0],{...reply(2).data.trips[0],registration:'OTHER'}]};c.state.cartrackIgnitionPlate='BJ57';const html=c.renderCartrackIgnitionHistory();assert(!html.includes('OTHER'));assert(html.includes('01:00:00'));
 console.log(file+': PASS multi-page history, stable period, partial page cap, mid-query failure and out-of-order response after period change.');
}})().catch(e=>{console.error(e);process.exitCode=1});
