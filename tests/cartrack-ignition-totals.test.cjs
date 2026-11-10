const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const api=require('../cartrack-ignition.js');
for(const file of ['app.js','teste/app.js']){
 const s=fs.readFileSync(file,'utf8'),c={Date,Intl};vm.createContext(c);vm.runInContext(s.slice(s.indexOf('function localDay('),s.indexOf('function activityReportRange(')),c);
 const calendar={day:c.localDay,nextDayStart:day=>c.reportMidnight(c.reportDayShift(day,1))};
 const range={start:Date.parse('2026-11-09T00:00:00Z'),end:Date.parse('2026-11-11T00:00:00Z')};
 const trip=(id,start,end,registration='BJ-57-AN')=>({id,start,end,registration});
 let result=api.summary([],range,'',calendar);assert.equal(result.totalSeconds,null);assert.equal(result.daily.length,0);
 const crossing=trip(1,'2026-11-09 23:59:50+00','2026-11-10 00:00:10+00');
 result=api.summary([crossing,crossing],range,'BJ57',calendar);assert.equal(result.totalSeconds,20);assert.equal(result.daily.length,2);assert(result.daily.every(row=>row.seconds===10));
 result=api.summary([crossing,trip(2,'2026-11-09 23:59:55+00','2026-11-10 00:00:15+00')],range,'',calendar);assert.equal(result.totalSeconds,25);assert.equal(result.vehicles[0].seconds,25);
 result=api.summary([crossing,trip(2,crossing.start,crossing.end,'OTHER')],range,'',calendar);assert.equal(result.totalSeconds,40);assert.equal(result.vehicles.length,2);
 result=api.summary([crossing],{start:Date.parse('2026-11-10T00:00:00Z'),end:Date.parse('2026-11-10T00:00:05Z')},'',calendar);assert.equal(result.totalSeconds,5);
 result=api.summary([trip(1,'2026-11-10 10:00:00+00',null),trip(2,'bad','2026-11-10 11:00:00+00')],range,'',calendar);assert.equal(result.totalSeconds,null);assert.equal(result.excluded,2);
 for(const [day,hours] of [['2026-03-29',23],['2026-10-25',25]]){
   const start=c.reportMidnight(day),end=calendar.nextDayStart(day);
   result=api.summary([trip(1,new Date(start).toISOString(),new Date(end).toISOString())],{start,end},'',calendar);
   assert.equal(result.totalSeconds,hours*3600);assert.equal(result.daily.length,1);assert.equal(result.daily[0].day,day);
 }
 assert.equal(api.summary([crossing],range,'XX',calendar).totalSeconds,null);
 console.log(file+': PASS daily/period totals, overlap union, midnight and range clipping, plate filter, missing data, 23/25-hour Lisbon DST days.');
}
