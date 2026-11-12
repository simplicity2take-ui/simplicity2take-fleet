(function(root){
  'use strict';
  const shifts=typeof module==='object'&&module.exports?require('./shift-mileage.js'):root.ShiftMileage;
  const plate=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const text=value=>String(value??'').trim();
  const stamp=shifts.timestamp;
  function resolve(row,kind,platform,entities){
    const id=row[kind+'_id'],uuid=text(row['platform_'+kind+'_uuid']);
    const field=platform+'_'+kind+'_uuid';
    let candidates=id?entities.filter(e=>e.id===id):entities;
    if(id&&candidates.length!==1)return null;
    if(uuid){
      const owners=entities.filter(e=>text(e[field])===uuid);
      // A UUID shared by multiple records never establishes identity.
      if(owners.length>1)return null;
      if(!id)candidates=owners;
      else if(owners.length===1&&owners[0].id!==id)return null;
      else if(text(candidates[0][field])&&text(candidates[0][field])!==uuid)return null;
    }
    if(kind==='vehicle'&&plate(row.vehicle_plate)){
      const key=plate(row.vehicle_plate);
      candidates=candidates.filter(e=>plate(e.plate)===key);
    }
    if(!id&&!uuid&&kind==='driver')return null;
    if(!id&&!uuid&&kind==='vehicle'&&!plate(row.vehicle_plate))return null;
    return candidates.length===1?candidates[0]:null;
  }
  function summarize({trips=[],drivers=[],vehicles=[],events=[],nativeSessions=[],cartrack=[],start,end,partial=false}){
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error('invalid_period');
    const declarations=shifts.sessions(events);
    let excludedTestSessions=0;
    for(const s of nativeSessions){
      if(s.is_test){excludedTestSessions++;continue;}
      const entry={driver_id:s.driver_id,vehicle_id:s.vehicle_id,registered_at:s.started_at};
      const exit=s.ended_at?{...entry,registered_at:s.ended_at}:null;
      const duration=stamp(s.ended_at)-stamp(s.started_at);
      declarations.push({entry,exit,flags:!exit?['missing_exit']:s.closure_kind==='admin'?['admin_closure_requires_review']:stamp(s.started_at)===null||stamp(s.ended_at)===null||duration<=0||duration>36*3600000?['invalid_or_long_shift']:[]});
    }
    // Native and form declarations are one review set; conflicting sources cannot validate each other.
    for(const s of declarations){
      if(s.entry?.review_flags?.length||s.exit?.review_flags?.length)s.flags.push('source_review_pending');
      if(!s.entry||!s.exit)continue;
      const a=stamp(s.entry.registered_at),b=stamp(s.exit.registered_at);
      if(a===null||b===null)continue;
      if(declarations.some(other=>{
        if(other===s||!other.entry)return false;
        const c=stamp(other.entry.registered_at),d=stamp(other.exit?.registered_at);
        if(c===null||!((c>=a&&c<b)||(d!==null&&c<b&&d>a)))return false;
        return (other.entry.driver_id===s.entry.driver_id&&other.entry.vehicle_id!==s.entry.vehicle_id)||(other.entry.vehicle_id===s.entry.vehicle_id&&other.entry.driver_id!==s.entry.driver_id);
      }))s.flags.push('conflicting_declaration');
    }
    const result={groups:[],completed:0,excludedNonCompleted:0,undated:0,invalidTimes:0,identityPending:[],duplicateTrips:0,excludedTestSessions,partial,coverageVerified:false};
    const groups=new Map(),seen=new Set();
    for(const t of trips){
      if(!['uber','bolt'].includes(t.platform))continue;
      // A missing source ID cannot be safely deduplicated or compared.
      if(!text(t.source_trip_id)){result.identityPending.push({id:t.id,reason:'missing_source_trip_id'});continue;}
      const key=t.platform+'|'+t.source_trip_id;
      if(seen.has(key)){result.duplicateTrips++;result.partial=true;continue;}seen.add(key);
      const recorded=[t.accepted_at,t.pickup_at,t.dropoff_at,t.finished_at,t.observed_at].map(stamp).filter(x=>x!==null);
      if(!recorded.length){result.undated++;continue;}
      // This is a dated-record view, not a claim to capture every service spanning the day.
      if(!recorded.some(at=>at>=start&&at<end))continue;
      if(t.order_status!=='completed'){result.excludedNonCompleted++;continue;}
      const serviceTimes=[t.accepted_at,t.pickup_at,t.dropoff_at,t.finished_at].map(stamp).filter(x=>x!==null);
      if(!serviceTimes.length){result.undated++;continue;}
      if(!serviceTimes.some(at=>at>=start&&at<end))continue;
      const driver=resolve(t,'driver',t.platform,drivers),vehicle=resolve(t,'vehicle',t.platform,vehicles);
      if(!driver||!vehicle){result.identityPending.push({id:t.id,source_trip_id:t.source_trip_id,reason:'identity_unconfirmed'});continue;}
      const first=Math.min(...serviceTimes),last=Math.max(...serviceTimes);
      const serviceStart=stamp(t.accepted_at)??stamp(t.pickup_at);
      const serviceEnd=stamp(t.finished_at)??stamp(t.dropoff_at);
      if(serviceStart!==null&&serviceEnd!==null&&serviceEnd<serviceStart){result.invalidTimes++;continue;}
      const groupKey=driver.id+'|'+vehicle.id;
      if(!groups.has(groupKey))groups.set(groupKey,{driverId:driver.id,driverName:String(driver.full_name||'Motorista identificado'),vehicleId:vehicle.id,plate:vehicle.plate,uber:0,bolt:0,firstObserved:first,lastObserved:last,missingServiceStart:0,missingServiceEnd:0,compatibleDeclarations:0,declarationPending:0,cartrackMatches:cartrack.filter(c=>plate(c.registration)===plate(vehicle.plate)).length});
      const g=groups.get(groupKey);g[t.platform]++;result.completed++;
      g.firstObserved=Math.min(g.firstObserved,first);g.lastObserved=Math.max(g.lastObserved,last);
      if(serviceStart===null)g.missingServiceStart++;
      if(serviceEnd===null)g.missingServiceEnd++;
      const compatible=declarations.some(s=>s.entry&&s.exit&&!s.flags.length&&s.entry.driver_id===driver.id&&s.entry.vehicle_id===vehicle.id&&stamp(s.entry.registered_at)<=first+300000&&stamp(s.exit.registered_at)>=last-300000);
      g[compatible?'compatibleDeclarations':'declarationPending']++;
    }
    if(result.partial)for(const g of groups.values()){g.declarationPending+=g.compatibleDeclarations;g.compatibleDeclarations=0;}
    result.groups=[...groups.values()].sort((a,b)=>a.driverName.localeCompare(b.driverName,'pt')||a.plate.localeCompare(b.plate));
    return result;
  }
  const api={summarize};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.TripConference=api;
})(typeof globalThis==='undefined'?this:globalThis);
