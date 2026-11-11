const assert=require('node:assert/strict');
for(const file of ['../native-shifts.js','../teste/native-shifts.js']){
 const {qrToken,session,reviewTrips}=require(file);
 const token='a'.repeat(32),origin='https://fleet.example.test';
 assert.equal(qrToken(origin+'/?vehicle='+token+'&mode=driver',origin),token);
 assert.equal(qrToken('https://other.example.test/?vehicle='+token,origin),'');
 assert.equal(qrToken('not-a-qr',origin),'');
 const s={driver_id:'driver-a',vehicle_id:'vehicle-a',vehicle_plate:'AA-00-AA',driver_name:'Test',started_at:'2026-11-10T08:00:00Z',ended_at:'2026-11-10T16:00:00Z'};
 const d={uber_driver_uuid:'uber-a',bolt_driver_uuid:'bolt-a'};
 const t={platform:'uber',source_trip_id:'trip-a',driver_id:'driver-a',vehicle_id:'vehicle-a',accepted_at:'2026-11-10T10:00:00Z',finished_at:'2026-11-10T11:00:00Z'};
 assert.equal(session(s).flags.length,0);
 assert.equal(session({...s,ended_at:null}).exit,null);
 assert.ok(session({...s,ended_at:'2026-11-12T16:00:00Z'}).flags.includes('invalid_or_long_shift'));
 assert.equal(reviewTrips({...s,ended_at:'2026-11-12T16:00:00Z'},[t],d).state,'review');
 assert.equal(reviewTrips(s,[t],d).state,'checked_available_data');
 assert.ok(reviewTrips(s,[t],d).flags.includes('platform_coverage_unconfirmed'));
 assert.equal(reviewTrips(s,[],d).state,'pending');
 assert.equal(reviewTrips(s,[t],d,true).state,'pending');
 assert.equal(reviewTrips(s,[t,t],d).counts.uber,1);
 assert.equal(reviewTrips(s,[{...t,vehicle_id:'other'}],d).state,'review');
 assert.equal(reviewTrips(s,[{...t,driver_id:'other'}],d).state,'review');
 assert.equal(reviewTrips(s,[{...t,driver_id:null,platform_driver_uuid:'uber-a'}],d).counts.uber,1);
 assert.ok(reviewTrips(s,[{...t,accepted_at:'2026-11-10T07:00:00Z'}],d).flags.includes('trip_crosses_shift_boundary'));
 const undated={...t,accepted_at:null,finished_at:null};
 assert.equal(reviewTrips(s,[undated],d).state,'pending');
 assert.ok(reviewTrips(s,[undated],d).flags.includes('undated_driver_trips'));
 assert.equal(reviewTrips(s,[{...t,accepted_at:'2026-11-09T08:00:00Z',finished_at:'2026-11-09T09:00:00Z'}],d).counts.uber,0);
 console.log(file+': PASS QR origin, open shifts, platform identity, mismatches, incomplete data and deduplication');
}
