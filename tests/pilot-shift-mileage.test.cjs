const assert=require('node:assert/strict');
for(const file of ['../teste/shift-mileage.js']){
 const {sessions,reading,mileage}=require(file);
 const event=(kind,time,vehicle='v',plate='AA-00-AA')=>({event_kind:kind,registered_at:time,driver_id:'d',vehicle_id:vehicle,vehicle_plate:plate,driver_name:'Test driver'});
 const entry=event('entry','2026-11-09T22:00:00Z'),exit=event('exit','2026-11-10T06:00:00Z');
 const trips=[{registration:'AA00AA',start:'2026-11-09 22:02:00+00:00',end:'2026-11-10T05:59:00Z',startOdometerKm:1000,endOdometerKm:1120}];
 const [shift]=sessions([exit,entry]);assert.equal(shift.flags.length,0);assert.equal(mileage(shift,trips).distance,120);
 assert.equal(mileage(shift,trips).start.gapSeconds,120);
 assert.equal(mileage(shift,trips,true).distance,null);
 assert.equal(mileage(sessions([entry])[0],trips).distance,null);
 assert.equal(mileage(sessions([exit])[0],trips).distance,null);
 assert.equal(reading(trips,'OTHER',entry.registered_at),null);
 assert.equal(reading(trips,'AA-00-AA','2026-11-09T21:00:00Z'),null);
 assert.equal(reading([{...trips[0],startOdometerKm:null,endOdometerKm:null}],'AA-00-AA',entry.registered_at),null);
 assert.equal(mileage(shift,[{...trips[0],endOdometerKm:900}]).distance,null);
 assert.equal(mileage(shift,[{...trips[0],end:trips[0].start}]).distance,null);
 const ties=[{...trips[0],start:'2026-11-09T21:59:00Z',startOdometerKm:999},{...trips[0],start:'2026-11-09T22:01:00Z',startOdometerKm:1001}];
 assert.equal(reading(ties,'AA00AA',entry.registered_at),null);
 const repeated=sessions([entry,event('entry','2026-11-09T23:00:00Z'),exit]);
 assert.ok(repeated.some(s=>s.flags.includes('repeated_entry')));
 const overlapping=sessions([entry,event('entry','2026-11-09T23:00:00Z','v2','BB-00-BB'),exit,event('exit','2026-11-10T07:00:00Z','v2','BB-00-BB')]);
 assert.ok(overlapping.every(s=>s.flags.includes('overlapping_shift')));
 assert.equal(mileage(overlapping[0],trips).distance,null);
 // An intervening entry must block mileage even when its own exit is absent.
 const switchEntry=event('entry','2026-11-09T23:00:00Z','v2','BB-00-BB');
 const switched=sessions([entry,switchEntry,exit]).find(s=>s.entry===entry);
 assert.ok(switched.flags.includes('conflicting_entry'));
 assert.equal(mileage(switched,trips).distance,null);
 const handover={...event('entry','2026-11-09T23:00:00Z'),driver_id:'other'};
 const shared=sessions([entry,handover,exit]).find(s=>s.entry===entry);
 assert.ok(shared.flags.includes('conflicting_entry'));
 assert.equal(mileage(shared,trips).distance,null);
 const unknownHandover={...handover,driver_id:null};
 assert.ok(sessions([entry,unknownHandover,exit]).find(s=>s.entry===entry).flags.includes('conflicting_entry'));
 const simultaneous={...switchEntry,registered_at:entry.registered_at};
 assert.ok(sessions([entry,simultaneous,exit]).find(s=>s.entry===entry).flags.includes('conflicting_entry'));
 const legitimate=sessions([entry,exit,event('entry',exit.registered_at,'v2','BB-00-BB'),event('exit','2026-11-10T08:00:00Z','v2','BB-00-BB')]);
 assert.ok(legitimate.every(s=>s.flags.length===0));
 const unrelated={...switchEntry,driver_id:'other'};
 assert.equal(sessions([entry,unrelated,exit]).find(s=>s.entry===entry).flags.length,0);
 assert.ok(sessions([{...entry,driver_id:null},exit])[0].flags.length);
 assert.ok(sessions([entry,event('exit','2026-11-12T06:00:00Z')])[0].flags.includes('invalid_or_long_shift'));
 console.log(file+': PASS midnight pairing, missing/duplicate/overlapping entries, nearest readings, ambiguity, odometer reversal and incomplete-history protection');
}

