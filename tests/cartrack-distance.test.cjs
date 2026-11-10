const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
for(const file of ['app.js','teste/app.js']){
 const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8'),c={state:{cartrackSnapshots:[]},Date,Intl,Map,Number};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function localDay('),source.indexOf('\nfunction renderActivity(')),c);
 const range={start:Date.parse('2026-07-10T00:00:00Z'),end:Date.parse('2026-07-12T00:00:00Z')};
 const point=(time,odo,registration='TEST')=>({registration,observedAt:time,odometerKm:odo});
 let r=c.cartrackDistanceSummary(range);assert.equal(r.total,null);
 c.state.cartrackSnapshots=[point('2026-07-10T12:00:00Z',100)];r=c.cartrackDistanceSummary(range);assert.equal(r.rows[0].distance,null);
 c.state.cartrackSnapshots.push(point('2026-07-10T14:00:00Z',125));r=c.cartrackDistanceSummary(range);assert.equal(r.total,25);assert.equal(r.rows[0].count,2);
 c.state.cartrackSnapshots.push(point('2026-07-10T14:00:00Z',125));assert.equal(c.cartrackDistanceSummary(range).rows[0].count,2);
 c.state.cartrackSnapshots.push(point('2026-07-10T16:00:00Z',50));r=c.cartrackDistanceSummary(range);assert.equal(r.total,null);assert.equal(r.rows[0].invalid,true);
 c.state.cartrackSnapshots=[point('2026-07-10T22:30:00Z',100),point('2026-07-10T23:30:00Z',110)];r=c.cartrackDistanceSummary(range);assert.equal(r.rows.length,2);assert.equal(r.total,null);assert.equal(r.rows[0].day,'2026-07-11');
 c.state.cartrackSnapshots=[point('2026-07-10T12:00:00Z',100),point('2026-07-10T12:00:00Z',101)];assert.equal(c.cartrackDistanceSummary(range).rows[0].invalid,true);
 c.state.cartrackSnapshots=[point('2026-07-10T12:00:00Z',null),point('2026-07-10T13:00:00Z',-1),point('bad-date',100)];assert.equal(c.cartrackDistanceSummary(range).rows.length,0);
 c.state.cartrackSnapshots=[point('2026-07-10T00:00:00Z',0),point('2026-07-10T01:00:00Z',0),point('2026-07-12T00:00:00Z',200)];r=c.cartrackDistanceSummary(range);assert.equal(r.total,0);assert.equal(r.rows.length,1);
 console.log(file+': PASS observed km, insufficient data, duplicate/conflicting readings, odometer reset, Lisbon day boundaries and date range.');
}
