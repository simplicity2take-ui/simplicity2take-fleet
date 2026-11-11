const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
for(const file of ['app.js','teste/app.js']){
 const s=fs.readFileSync(path.join(__dirname,'..',file),'utf8'),now=Date.now();
 const car={registration:'TEST',eventTs:new Date(now-2*3600000).toISOString(),lastSyncedAt:new Date(now-60000).toISOString(),speedKmh:10};
 const c={Date,Intl,Map,Number,nativeShiftPortal:{adminPanel:()=>''},state:{vehicles:[{id:'v',plate:'TEST',brand:'Brand',model:'Model'}],cartrackVehicles:[car]},selectors:{pageTitle:{},content:{}},boltActivitySummary:()=>({trips:[],events:[],grouped:new Map(),latestByVehicle:new Map()}),heading:()=>'',metric:(label,value)=>label+':'+value,escapeHtml:x=>String(x||''),emptyRow:()=>''};vm.createContext(c);vm.runInContext(s.slice(s.indexOf("function localDay("),s.indexOf("function activityReportRange(")),c);
 vm.runInContext(s.slice(s.indexOf('function cartrackDistanceSummary('),s.indexOf('\nasync function syncCartrack(')),c);
 assert.equal(c.cartrackTimestampIsStale(new Date(now-30*60000).toISOString(),now),false);assert.equal(c.cartrackTimestampIsStale(new Date(now-30*60000-1).toISOString(),now),true);for(const v of ['',null,'bad-date',new Date(now+60000).toISOString()])assert.equal(c.cartrackTimestampIsStale(v,now),true);
 c.renderActivity();let html=c.selectors.content.innerHTML;assert(html.includes('Leituras Cartrack antigas:1'));assert(html.includes('Leitura antiga ou sem data'));assert(html.includes('>Recente</span>'));assert(html.includes('Há dados antigos'));
 car.eventTs=new Date(now-60000).toISOString();car.lastSyncedAt=new Date(now-2*3600000).toISOString();c.renderActivity();html=c.selectors.content.innerHTML;assert(html.includes('Leituras Cartrack antigas:0'));assert(!html.includes('Leitura antiga ou sem data'));assert(html.includes('>Desatualizada</span>'));
 c.state.cartrackVehicles.push({registration:'EXTRA',eventTs:new Date(now-60000).toISOString(),lastSyncedAt:new Date(now-60000).toISOString()});
 c.renderActivity();html=c.selectors.content.innerHTML;assert(html.includes('Viaturas Cartrack:2'));assert(html.includes('Cartrack sem registo no Fleet:1'));assert(html.includes('Sem registo no Fleet'));assert.equal((html.match(/<strong>EXTRA<\/strong>/g)||[]).length,1);
 c.state.vehicles.push({id:'extra',plate:'EXTRA',brand:'Brand',model:'Model'});c.renderActivity();html=c.selectors.content.innerHTML;assert(html.includes('Cartrack sem registo no Fleet:0'));assert.equal((html.match(/<strong>EXTRA<\/strong>/g)||[]).length,1);assert(!html.includes('>Sem registo no Fleet</span>'));
 console.log(file+': PASS reading age independent of sync age, boundary, missing/invalid/future timestamps displayed indicators and unmatched vehicle coverage.');
}
