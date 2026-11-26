const assert=require('node:assert/strict');
for(const file of ['../shift-mileage.js','../teste/shift-mileage.js']){
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

for (const file of ['../shift-mileage.js', '../teste/shift-mileage.js', '../supabase/functions/shift-review/shift-mileage.js']) {
  const { sessions, mileage } = require(file);
  const at = hour => '2026-11-10T' + String(hour).padStart(2, '0') + ':00:00Z';
  function pair(driver, vehicle, plate, startHour, endHour) {
    const row = { driver_id: driver, vehicle_id: vehicle, vehicle_plate: plate };
    return [
      { ...row, event_kind: 'entry', registered_at: at(startHour) },
      { ...row, event_kind: 'exit', registered_at: at(endHour) },
    ];
  }
  const first = pair('one', 'car', 'AA-00-AA', 8, 12);
  const readings = [
    { registration: 'AA00AA', start: at(8), end: at(12), startOdometerKm: 100, endOdometerKm: 180 },
    { registration: 'AA00AA', start: at(10), end: at(14), startOdometerKm: 140, endOdometerKm: 220 },
  ];
  for (const flagged of [0, 1]) {
    const events = first.map((row, index) => ({...row, review_flags: index === flagged ? ['source_changed_pending_review'] : []}));
    const [shift] = sessions(events);
    assert.equal(mileage(shift, readings).distance, null, file + ' must withhold mileage pending source review');
    assert.ok(shift.flags.includes('source_review_pending'));
    assert.equal(events[flagged].review_flags.length, 1);
  }
  const trip = readings[0];
  for (const plate of [null, '---']) {
    const [shift] = sessions(pair('one', 'car', plate, 8, 12));
    assert.equal(mileage(shift, [{ ...trip, registration: '' }]).distance, null);
  }
  const [contradictory] = sessions([first[0], { ...first[1], vehicle_plate: 'BB-11-BB' }]);
  assert.equal(mileage(contradictory, [trip, { ...trip, registration: 'BB11BB', endOdometerKm: 8000 }]).distance, null);
  const [consistent] = sessions([first[0], { ...first[1], vehicle_plate: ' aa00aa ' }]);
  assert.equal(mileage(consistent, readings).distance, 80);

  for (const second of [
    pair('two', 'car', 'AA00AA', 10, 14),
    pair('two', 'other-id', ' aa00aa ', 10, 14),
    pair('two', 'car', 'AA00AA', 10, 11),
  ]) {
    const shifts = sessions([...second, ...first]);
    assert.equal(shifts.length, 2);
    for (const shift of shifts) {
      assert.ok(shift.flags.includes('overlapping_shift'), file + ' must flag both drivers');
      assert.equal(mileage(shift, readings).distance, null);
    }
  }
  for (const second of [
    pair('two', 'car', 'AA00AA', 12, 14),
    pair('two', 'another-car', 'BB11BB', 10, 14),
    pair('two', 'another-car', '', 10, 14),
  ]) {
    assert.ok(sessions([...first, ...second]).every(s => s.flags.length === 0));
  }
}

const {test} = require('node:test');
test('checks the odometer history between the selected shift readings', () => {
  const {mileage, sessions} = require('../shift-mileage.js');
  const at = hour => '2026-11-10T' + String(hour).padStart(2, '0') + ':00:00Z';
  const row = {driver_id:'d', vehicle_id:'v', vehicle_plate:'AA-00-AA'};
  const [shift] = sessions([
    {...row, event_kind:'entry', registered_at:at(8)},
    {...row, event_kind:'exit', registered_at:at(16)}
  ]);
  const trip = (start, end, first, last) => ({
    registration:'AA00AA', start:at(start), end:at(end), startOdometerKm:first, endOdometerKm:last
  });
  const edges = trip(8,16,1000,1120);
  for (const middle of [
    [trip(10,11,1080,1060)],
    [trip(10,11,1040,1060),trip(12,13,1050,1100)],
    [trip(10,12,1040,1050),trip(12,14,1060,1100)]
  ]) {
    for (const history of [[edges,...middle],[...middle,edges]]) {
      const result = mileage(shift, history);
      assert.equal(result.distance, null);
      assert.equal(result.reason, 'inconsistent_readings');
      assert.equal(result.start.km, 1000);
      assert.equal(result.end.km, 1120);
    }
  }
  const shared = trip(10,12,1050,1070);
  const history = [
    trip(12,14,1070,1090), shared, edges, shared,
    trip(17,18,10,5), {...trip(10,12,500,0), registration:'BB11BB'}
  ];
  assert.equal(mileage(shift, history).distance, 120);
  assert.equal(mileage(shift, [trip(8,16,1000,1000),trip(10,12,1000,1000)]).distance, 0);
});
