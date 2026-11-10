const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const CartrackIgnition=require('../cartrack-ignition.js');
(async()=>{for(const file of ['app.js','teste/app.js']){
 const source=fs.readFileSync(file,'utf8');let calls=0,resolveRequest;
 const c={Date,Number,Math,CartrackIgnition,state:{profile:{role:'driver'},sessionUserId:'u',activeView:'activity'},document:{querySelector:()=>({value:'BJ57'})},escapeHtml:x=>String(x),renderActivity:()=>{},boltActivitySummary:()=>({range:{start:Date.now()-86400000,end:Date.now()+86400000}}),supabaseClient:{functions:{invoke:async()=>{calls++;return {data:{success:true,trips:[],meta:{last_page:1}}}}}}};vm.createContext(c);vm.runInContext(source.slice(source.indexOf("function localDay("),source.indexOf("function activityReportRange(")),c);vm.runInContext(source.slice(source.indexOf('function renderCartrackIgnitionHistory('),source.indexOf('function renderActivity(')),c);
 await c.loadCartrackIgnitionHistory();assert.equal(calls,0);
 c.state.profile.role='admin';await c.loadCartrackIgnitionHistory();assert.equal(calls,1);assert(c.state.cartrackIgnitionHistory.range.end<=Date.now());assert(c.renderCartrackIgnitionHistory().includes('Sem intervalos devolvidos'));
 c.supabaseClient.functions.invoke=()=>new Promise(r=>resolveRequest=r);const pending=c.loadCartrackIgnitionHistory();c.state.cartrackIgnitionHistory=null;c.state.profile=null;c.state.sessionUserId=null;resolveRequest({data:{success:true,trips:[{id:1}],meta:{last_page:1}}});await pending;assert.equal(c.state.cartrackIgnitionHistory,null);
 console.log(file+': PASS driver guard, period clipping, empty history and discard response after logout.');
}})().catch(e=>{console.error(e);process.exitCode=1});
