const {test}=require('node:test'),assert=require('node:assert/strict');
const {summarize}=require('../trip-conference.js');
const start=Date.parse('2026-11-10T00:00:00Z'),end=start+86400000;
const drivers=[{id:'d1',full_name:'Motorista A',uber_driver_uuid:'u1',bolt_driver_uuid:'b1'},{id:'d2',full_name:'Motorista B',bolt_driver_uuid:'b2'}];
const vehicles=[{id:'v1',plate:'AA-00-AA',uber_vehicle_uuid:'uv1',bolt_vehicle_uuid:'bv1'},{id:'v2',plate:'BB-11-BB',uber_vehicle_uuid:'uv2',bolt_vehicle_uuid:'bv2'}];
const trip={id:'t1',source_trip_id:'s1',platform:'bolt',driver_id:'d1',vehicle_id:'v1',platform_driver_uuid:'b1',platform_vehicle_uuid:'bv1',vehicle_plate:' aa00aa ',order_status:'completed',accepted_at:'2026-11-10T11:00:00Z',finished_at:'2026-11-10T11:30:00Z'};
const events=[{id:'e',driver_id:'d1',vehicle_id:'v1',vehicle_plate:'AA-00-AA',registered_at:'2026-11-10T10:00:00Z',event_kind:'entry'},{id:'x',driver_id:'d1',vehicle_id:'v1',vehicle_plate:'AA-00-AA',registered_at:'2026-11-10T12:00:00Z',event_kind:'exit'}];
const run=extra=>summarize({trips:[trip],drivers,vehicles,events,start,end,...extra});
test('combines actual platforms, keeps two vehicles separate and excludes unsuccessful requests',()=>{
  const uber={...trip,id:'t2',source_trip_id:'s2',platform:'uber',platform_driver_uuid:'u1',platform_vehicle_uuid:'uv2',vehicle_id:'v2',vehicle_plate:'BB-11-BB',accepted_at:null,finished_at:'2026-11-10T09:00:00Z'};
  const r=run({trips:[trip,uber,{...trip,id:'t3',source_trip_id:'s3',order_status:'rider_cancelled'}]});
  assert.equal(r.completed,2);assert.equal(r.groups.length,2);assert.equal(r.excludedNonCompleted,1);assert.equal(r.coverageVerified,false);
  const a=r.groups.find(g=>g.vehicleId==='v1'),b=r.groups.find(g=>g.vehicleId==='v2');
  assert.equal(a.compatibleDeclarations,1);assert.equal(b.declarationPending,1);assert.equal(b.missingServiceStart,1);assert.equal(b.firstObserved,b.lastObserved);
  assert.equal('distance' in a,false);assert.equal('started_at' in a,false);
});
test('rejects conflicting UUIDs/plates and ambiguous UUID-only matches',()=>{
  for(const delta of [{platform_driver_uuid:'b2'},{platform_vehicle_uuid:'bv2'},{vehicle_plate:'BB-11-BB'},{driver_id:'unknown'}]){
    const r=run({trips:[{...trip,...delta}]});assert.equal(r.completed,0);assert.equal(r.identityPending.length,1);
  }
  const duplicate=[...drivers,{id:'d3',full_name:'Outro',bolt_driver_uuid:'b1'}];
  assert.equal(run({drivers:duplicate,trips:[{...trip,driver_id:null}]}).completed,0);
  assert.equal(run({drivers:[{...drivers[0],bolt_driver_uuid:null},drivers[1]],trips:[{...trip,platform_driver_uuid:'b2'}]}).completed,0);
});
test('open, contradictory, administrative and test declarations never validate operational activity',()=>{
  assert.equal(run({events:[events[0]]}).groups[0].declarationPending,1);
  assert.equal(run({events:[{...events[0],review_flags:['source_changed_pending_review']},events[1]]}).groups[0].declarationPending,1);
  assert.equal(run({events:[...events,{id:'other',event_kind:'entry',driver_id:'d2',vehicle_id:'v1',vehicle_plate:'AA-00-AA',registered_at:'2026-11-10T10:30:00Z'}]}).groups[0].declarationPending,1);
  const native={id:'native',driver_id:'d1',vehicle_id:'v1',started_at:events[0].registered_at,ended_at:events[1].registered_at};
  assert.equal(run({events:[],nativeSessions:[native]}).groups[0].compatibleDeclarations,1);
  for(const delta of [{is_test:true},{closure_kind:'admin'},{started_at:'bad'},{ended_at:null}])assert.equal(run({events:[],nativeSessions:[{...native,...delta}]}).groups[0].declarationPending,1);
  assert.equal(run({nativeSessions:[{...native,vehicle_id:'v2'}]}).groups[0].declarationPending,1);
});
test('midnight declarations, partial pages, missing times and duplicate trips remain explicit',()=>{
  const midnight=[{...events[0],registered_at:'2026-11-09T22:00:00Z'},{...events[1],registered_at:'2026-11-10T12:00:00Z'}];
  assert.equal(run({events:midnight}).groups[0].compatibleDeclarations,1);
  const r=run({trips:[trip,trip,{...trip,id:'no-time',source_trip_id:'s4',accepted_at:null,finished_at:null,observed_at:'2026-11-10T12:00:00Z'}]});
  assert.equal(r.completed,1);assert.equal(r.duplicateTrips,1);assert.equal(r.partial,true);assert.equal(r.undated,1);
  assert.equal(run({partial:true}).partial,true);
  assert.equal(run({partial:true}).groups[0].compatibleDeclarations,0);
  assert.equal(run({trips:[{...trip,finished_at:'2026-11-10T10:00:00Z'}]}).invalidTimes,1);
  assert.throws(()=>run({end:start}));
});
test('excludes observations outside the selected day and never changes inputs',()=>{
  const input={trips:[trip],drivers,vehicles,events,start,end};const original=JSON.stringify(input);summarize(input);assert.equal(JSON.stringify(input),original);
  assert.equal(run({trips:[{...trip,accepted_at:'2026-11-09T11:00:00Z',finished_at:'2026-11-09T11:30:00Z'}]}).completed,0);
  assert.equal(run({trips:[{...trip,accepted_at:'2026-11-09T11:00:00Z',finished_at:'2026-11-09T11:30:00Z',observed_at:'2026-11-10T12:00:00Z'}]}).completed,0);
});
test('service details retain original times and every compatible source without inventing missing starts',()=>{
  const native={id:'native',driver_id:'d1',vehicle_id:'v1',started_at:events[0].registered_at,ended_at:events[1].registered_at};
  const r=run({nativeSessions:[native]}),s=r.groups[0].services[0];
  assert.equal(s.acceptedAt,Date.parse(trip.accepted_at));assert.equal(s.pickupAt,null);assert.equal(s.endedAt,Date.parse(trip.finished_at));
  assert.deepEqual(s.matches.map(m=>m.source).sort(),['app','form']);assert.equal(r.groups[0].compatibleDeclarations,1);
  const point=run({trips:[{...trip,accepted_at:null}]}).groups[0].services[0];assert.equal(point.acceptedAt,null);assert.equal(point.pickupAt,null);assert.equal(point.matches.length,1);
  const partial=run({partial:true}).groups[0].services[0];assert.equal(partial.state,'partial');assert.deepEqual(partial.matches,[]);
});
