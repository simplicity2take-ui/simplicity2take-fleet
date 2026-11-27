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
  const native={id:'native',driver_id:'d1',vehicle_id:'v1',vehicle_plate:vehicles[0].plate,started_at:events[0].registered_at,ended_at:events[1].registered_at};
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
  const native={id:'native',driver_id:'d1',vehicle_id:'v1',vehicle_plate:vehicles[0].plate,started_at:events[0].registered_at,ended_at:events[1].registered_at};
  const r=run({nativeSessions:[native]}),s=r.groups[0].services[0];
  assert.equal(s.acceptedAt,Date.parse(trip.accepted_at));assert.equal(s.pickupAt,null);assert.equal(s.endedAt,Date.parse(trip.finished_at));
  assert.deepEqual(s.matches.map(m=>m.source).sort(),['app','form']);assert.equal(r.groups[0].compatibleDeclarations,1);
  const point=run({trips:[{...trip,accepted_at:null}]}).groups[0].services[0];assert.equal(point.acceptedAt,null);assert.equal(point.pickupAt,null);assert.equal(point.matches.length,1);
  const partial=run({partial:true}).groups[0].services[0];assert.equal(partial.state,'partial');assert.deepEqual(partial.matches,[]);
});

test('compares declared plates with the identified service vehicle', () => {
  for (const module of ['../trip-conference.js', '../teste/trip-conference.js']) {
    const summarize = require(module).summarize;
    function group(entryPlate, exitPlate) {
      const declared = events.map((event, i) => ({ ...event, vehicle_plate: i ? exitPlate : entryPlate }));
      return summarize({ trips: [trip], drivers, vehicles, events: declared, start, end }).groups[0];
    }
    for (const [entry, exit] of [['AA00AA', 'BB11BB'], ['BB11BB', 'AA00AA'], ['BB11BB', 'BB11BB']]) {
      const result = group(entry, exit);
      assert.equal(result.bolt, 1);
      assert.equal(result.declarationPending, 1);
      assert.deepEqual(result.services[0].matches, []);
    }
    assert.equal(group(' aa00aa ', 'AA-00-AA').compatibleDeclarations, 1);
    assert.equal(group(null, null).compatibleDeclarations, 1);
  }
});

test('an empty registration cannot establish presence in the CarTrack roster', () => {
  const vehicle = { ...vehicles[0], plate: '' };
  const service = { ...trip, vehicle_plate: null };
  const result = run({ vehicles: [vehicle], trips: [service], cartrack: [{registration: null}] });
  assert.equal(result.groups[0].cartrackMatches, 0);
});

test('lists both vehicles when one confirmed vehicle lacks a plate', () => {
  const secondTrip = { ...trip, id: 't2', source_trip_id: 's2', vehicle_id: 'v2', platform_vehicle_uuid: 'bv2', vehicle_plate: null };
  const result = run({ vehicles: [vehicles[0], { ...vehicles[1], plate: null }], trips: [trip, secondTrip] });
  assert.equal(result.completed, 2);
  assert.equal(result.groups.find(group => group.vehicleId === 'v2').cartrackMatches, 0);
});

test('checks all available service times before confirming a declaration', () => {
  const at = minute => '2026-11-10T11:' + minute + ':00Z';
  for (const times of [
    { accepted_at: at('10'), pickup_at: at('05') },
    { pickup_at: at('20'), dropoff_at: at('15') },
    { dropoff_at: at('35'), finished_at: at('30') },
    { pickup_at: at('35'), dropoff_at: null },
  ]) {
    const result = run({ trips: [{ ...trip, ...times }] });
    assert.equal(result.invalidTimes, 1);
    assert.equal(result.completed, 0);
    assert.equal(result.groups.length, 0);
  }
  const valid = { ...trip, accepted_at: null, pickup_at: at('15'), dropoff_at: at('30'), observed_at: at('05') };
  assert.equal(run({ trips: [valid] }).groups[0].compatibleDeclarations, 1);
});

test('a short service at handover matches only the declaration it overlaps', () => {
  const at = time => '2026-11-10T' + time + ':00Z';
  const shifts = [...events, {...events[0],id:'e2',registered_at:at('12:00')}, {...events[1],id:'x2',registered_at:at('16:00')}];
  for (const [from, to, expected] of [['11:56','12:00','10:00'], ['12:00','12:04','12:00'], ['12:01','12:04','12:00']]) {
    const service = {...trip,accepted_at:at(from),finished_at:at(to)};
    const matches = run({events:shifts,trips:[service]}).groups[0].services[0].matches;
    assert.deepEqual(matches.map(match=>match.entry),[Date.parse(at(expected))]);
  }
  const crossing = {...trip,accepted_at:at('11:59'),finished_at:at('12:06')};
  assert.equal(run({events:shifts,trips:[crossing]}).groups[0].services[0].matches.length,1);
});

test('uses the recorded stage when a handover trip has only one observed instant', () => {
  const at = time => '2026-11-10T' + time + ':00Z';
  const shifts = [...events, {...events[0],id:'e2',registered_at:at('12:00')}, {...events[1],id:'x2',registered_at:at('16:00')}];
  const base = {...trip,platform:'uber',platform_driver_uuid:'u1',platform_vehicle_uuid:'uv1',accepted_at:null,finished_at:null};
  for (const [delta, expected] of [
    [{dropoff_at:at('12:00'),finished_at:at('12:00')},'10:00'],
    [{finished_at:at('12:01')},'12:00'],
    [{pickup_at:at('12:00')},'12:00'],
    [{accepted_at:at('11:59')},'10:00'],
  ]) {
    const group = run({events:shifts,trips:[{...base,...delta}]}).groups[0];
    assert.equal(group.uber,1);
    assert.deepEqual(group.services[0].matches.map(match => match.entry),[Date.parse(at(expected))]);
    assert.equal(group.missingServiceStart,delta.finished_at ? 1 : 0);
    assert.equal(group.missingServiceEnd,delta.finished_at ? 0 : 1);
  }
});

test('a completed trip with identical start and end stays unattributed at a shift boundary', () => {
  const {reviewTrips} = require('../native-shifts.js');
  const at = time => '2026-11-10T' + time + ':00Z';
  const shifts = [...events, {...events[0], id:'e2', registered_at:at('12:00')},
    {...events[1], id:'x2', registered_at:at('16:00')}];
  for (const [time, expected] of [['09:59',[]], ['11:59',['10:00']], ['12:00',[]], ['12:01',['12:00']], ['16:01',[]]]) {
    const service = {...trip, accepted_at:at(time), finished_at:at(time)};
    const group = run({events:shifts, trips:[service]}).groups[0];
    assert.equal(group.bolt, 1);
    assert.deepEqual(group.services[0].matches.map(m=>m.entry), expected.map(t=>Date.parse(at(t))));
    for (const [from,to] of [['10:00','12:00'],['12:00','16:00']]) {
      const shift = {driver_id:'d1',vehicle_id:'v1',started_at:at(from),ended_at:at(to)};
      const result = reviewTrips(shift,[service],drivers[0]);
      assert.equal(result.counts.bolt, Number(expected.includes(from)));
      if (time === '12:00') assert.equal(result.state, 'review');
    }
  }
});

test('source references distinguish platforms, ignore padding and require a usable value', () => {
  const {reviewTrips} = require('../native-shifts.js');
  const shift = {driver_id:'d1',vehicle_id:'v1',vehicle_plate:vehicles[0].plate,started_at:events[0].registered_at,ended_at:events[1].registered_at};
  const otherPlatform = {...trip, platform:'uber', platform_driver_uuid:'u1', platform_vehicle_uuid:'uv1'};
  const padded = {...trip, id:'padded',source_trip_id:'  '+trip.source_trip_id+' '};
  for (const invalid of [null,'','   ']) {
    const unidentified = {...trip,id:'unknown',source_trip_id:invalid};
    const checked = reviewTrips(shift,[unidentified,trip],drivers[0]);
    assert.equal(checked.counts.bolt,1);
    assert.equal(checked.state,'review');
    assert.ok(checked.flags.includes('missing_source_trip_id'));
    assert.equal(run({trips:[unidentified,trip]}).completed,1);
    const unrelated = {...unidentified,driver_id:'other',vehicle_id:'other',vehicle_plate:null,platform_driver_uuid:null};
    assert.equal(reviewTrips(shift,[unrelated,trip],drivers[0]).state,'checked_available_data');
  }
  for (const records of [[trip,padded,otherPlatform],[padded,trip,otherPlatform]]) {
    const checked = reviewTrips(shift,records,drivers[0]);
    assert.deepEqual(checked.counts,{uber:1,bolt:1});
    assert.equal(checked.state,'review');
    const panel = run({trips:records});
    assert.equal(panel.completed,2);
    assert.equal(panel.duplicateTrips,1);
    assert.equal(panel.partial,true);
  }
});

test('conflicting ownership of a completed platform reference never chooses the first import', () => {
  const {reviewTrips} = require('../native-shifts.js');
  const shift = {driver_id:'d1',vehicle_id:'v1',vehicle_plate:vehicles[0].plate,
    started_at:events[0].registered_at,ended_at:events[1].registered_at};
  const unaffected = {...trip,source_trip_id:'other-service'};
  for (const change of [
    {driver_id:'d2',platform_driver_uuid:'b2'},
    {vehicle_id:'v2',vehicle_plate:'BB-11-BB',platform_vehicle_uuid:'bv2'},
    {platform_driver_uuid:'b2'}, {platform_vehicle_uuid:'bv2'}, {vehicle_plate:'BB11BB'}
  ]) {
    const different = {...trip,...change,id:'second',source_trip_id:' s1 '};
    for (const records of [[trip,different,unaffected],[different,trip,unaffected]]) {
      const panel = run({trips:records});
      assert.equal(panel.completed,1);
      assert.equal(panel.duplicateTrips,1);
      assert.equal(panel.identityPending.length,1);
      const review = reviewTrips(shift,records,drivers[0]);
      assert.equal(review.counts.bolt,1);
      assert.equal(review.state,'review');
    }
  }
});
