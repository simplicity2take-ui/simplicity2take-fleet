const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{for(const file of ['app.js','teste/app.js']){
 const source=fs.readFileSync(file,'utf8');let calls=0,resolve;
 const c={Date,state:{profile:{role:'driver'},sessionUserId:'u',activeView:'activity'},escapeHtml:x=>String(x??''),renderActivity:()=>{},supabaseClient:{functions:{invoke:async()=>{calls++;return{data:{ok:false,error:'Acesso não concedido',code:498813}}}}}};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function renderBoltOnlineRead('),source.indexOf('function renderCartrackIgnitionHistory(')),c);
 await c.loadBoltOnlineRead();assert.equal(calls,0);c.state.profile.role='admin';await c.loadBoltOnlineRead();assert.equal(calls,1);assert(c.renderBoltOnlineRead().includes('498813'));assert(!c.renderBoltOnlineRead().includes('não devolveu motoristas online'));
 c.supabaseClient.functions.invoke=()=>new Promise(r=>resolve=r);const pending=c.loadBoltOnlineRead();c.state.boltOnlineRead=null;c.state.profile=null;c.state.sessionUserId=null;resolve({data:{ok:true,drivers:[]}});await pending;assert.equal(c.state.boltOnlineRead,null);
 console.log(file+': PASS driver guard, access-error visibility without false zero-online result, stale logout response discarded.');
}})().catch(e=>{console.error(e);process.exitCode=1});
