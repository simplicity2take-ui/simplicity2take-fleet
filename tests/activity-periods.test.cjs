const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
for(const file of ['app.js','teste/app.js']){
 const s=fs.readFileSync(path.join(__dirname,'..',file),'utf8'),c={state:{activityEvents:[],tripRecords:[]},Date,Intl,Map};vm.createContext(c);
 vm.runInContext(s.slice(s.indexOf('function activityStateLabel('),s.indexOf('\nfunction renderActivity(')),c);
 const now=Date.parse('2026-11-10T12:00:00Z');let r=c.activityReportRange(7,'current',now);assert.equal(new Date(r.start).toISOString(),'2026-11-09T00:00:00.000Z');r=c.activityReportRange(7,'previous',now);assert.equal(new Date(r.start).toISOString(),'2026-11-02T00:00:00.000Z');assert.equal(new Date(r.end).toISOString(),'2026-11-09T00:00:00.000Z');
 r=c.activityReportRange(7,'previous',Date.parse('2026-10-26T12:00:00Z'));assert.equal((r.end-r.start)/3600000,169);
 c.state.activityEvents=[{vehicleId:'v',status:'online',observedAt:'2026-07-10T22:30:00Z'},{vehicleId:'v',status:'offline',observedAt:'2026-07-10T23:30:00Z'}];
 r=c.boltActivitySummary(1,Date.parse('2026-07-11T00:00:00Z'));assert.equal(r.onlineMinutes,60);assert.equal(r.grouped.get('2026-07-10').onlineMinutes,30);assert.equal(r.grouped.get('2026-07-11').onlineMinutes,30);
 c.state.activityEvents=[{vehicleId:'v',status:'busy',observedAt:'2026-11-08T23:30:00Z'},{vehicleId:'v',status:'offline',observedAt:'2026-11-09T01:00:00Z'}];r=c.boltActivitySummary(7,now,'current');assert.equal(r.serviceMinutes,60);
 c.state.activityEvents=[];c.state.tripRecords=[{platform:'bolt',status:'completed',finishedAt:'2026-11-09T01:00:00Z',distance:10},{platform:'bolt',status:'cancelled',finishedAt:'2026-11-09T02:00:00Z',distance:50},{platform:'bolt',status:'completed',finishedAt:'2026-11-02T01:00:00Z',distance:7}];
 r=c.boltActivitySummary(7,now,'current');assert.equal(r.grouped.get('2026-11-09').trips,1);assert.equal(r.grouped.get('2026-11-09').distance,10);r=c.boltActivitySummary(7,now,'previous');assert.equal(r.grouped.get('2026-11-02').distance,7);
 console.log(file+': PASS Lisbon weeks/DST, midnight split, boundary clipping, cancelled trips and matching daily distances.');
}
