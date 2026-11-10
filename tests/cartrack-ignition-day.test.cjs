const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const api=require('../cartrack-ignition.js');
const now=Date.parse('2026-11-10T14:20:30.999Z');
(async()=>{for(const file of ['app.js','teste/app.js']){
 const source=fs.readFileSync(file,'utf8'),c={Date,Intl};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function localDay('),source.indexOf('function activityReportRange(')),c);
 const calendar={day:c.localDay,startDay:c.reportMidnight,nextDayStart:day=>c.reportMidnight(c.reportDayShift(day,1))};
 for(const [day,hours] of [['2026-03-29',23],['2026-10-25',25],['2026-11-09',24]]){const r=api.dayRange(day,now,calendar);assert.equal(r.end-r.start,hours*3600000);assert.equal(calendar.day(r.start),day);}
 assert.equal(api.dayRange('2026-11-10',now,calendar).end,Date.parse('2026-11-10T14:20:30Z'));
 for(const bad of ['2026-11-11','2026-02-30','2026-13-01','10/11/2026','',null])assert.equal(api.dayRange(bad,now,calendar),null);
 let day='2026-03-29',requests=[],toasts=[];
 Object.assign(c,{Number,Math,CartrackIgnition:api,state:{profile:{role:'admin'},sessionUserId:'admin',activeView:'activity'},document:{querySelector:selector=>({value:selector==='#cartrackIgnitionDay'?day:'BJ57'})},renderActivity:()=>{},showToast:text=>toasts.push(text),supabaseClient:{functions:{invoke:async(name,{body})=>{requests.push(body);return {data:{success:true,trips:[],meta:{last_page:1}}}}}}});
 c.Date=class extends Date{static now(){return now;}};
 vm.runInContext(source.slice(source.indexOf('async function loadCartrackIgnitionHistory('),source.indexOf('function renderActivity(')),c);
 await c.loadCartrackIgnitionHistory();assert.equal(requests.length,1);assert.equal(requests[0].start,'2026-03-29T00:00:00.000Z');assert.equal(requests[0].end,'2026-03-29T23:00:00.000Z');assert.equal(c.state.cartrackIgnitionDay,day);
 day='2026-11-11';await c.loadCartrackIgnitionHistory();assert.equal(requests.length,1);assert.equal(toasts.length,1);
 console.log(file+': PASS specific-day request, 23/24/25-hour Lisbon dates, clipping today to current second, invalid/future dates rejected before API call.');
}})().catch(e=>{console.error(e);process.exitCode=1});
