(function (root) {
  'use strict';
  const plateKey = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  function timestamp(value) {
    if (typeof value !== 'string' || !/(Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value)) return null;
    const time=Date.parse(value.replace(' ','T').replace(/([+-]\d{2})$/,'$1:00'));
    return Number.isFinite(time) ? time : null;
  }
  function sessions(events) {
    const open=new Map(), result=[];
    const rows=[...events].sort((a,b)=>(timestamp(a.registered_at)??Infinity)-(timestamp(b.registered_at)??Infinity)||Number(a.source_row)-Number(b.source_row));
    for (const row of rows) {
      const key=row.driver_id && row.vehicle_id ? `${row.driver_id}|${row.vehicle_id}` : null;
      if (!key || timestamp(row.registered_at)===null || !['entry','exit'].includes(row.event_kind)) {
        result.push({entry:row.event_kind==='entry'?row:null,exit:row.event_kind==='exit'?row:null,flags:['unconfirmed_identity_or_date']}); continue;
      }
      if (row.event_kind==='entry') {
        if (open.has(key)) result.push({entry:open.get(key),exit:null,flags:['missing_exit','repeated_entry']});
        open.set(key,row);
      } else if (open.has(key)) {
        const entry=open.get(key);open.delete(key);
        const duration=timestamp(row.registered_at)-timestamp(entry.registered_at);
        result.push({entry,exit:row,flags:duration<=0||duration>36*3600000?['invalid_or_long_shift']:[]});
      } else result.push({entry:null,exit:row,flags:['missing_entry']});
    }
    for (const entry of open.values()) result.push({entry,exit:null,flags:['missing_exit']});
    // A new entry can contradict an earlier pair even if it has no closing exit.
    // Keep the declared events, but withhold mileage until the conflict is reviewed.
    for (const session of result) {
      if (!session.entry || !session.exit) continue;
      const start=timestamp(session.entry.registered_at), end=timestamp(session.exit.registered_at);
      const conflict=rows.some(row=>{
        const at=timestamp(row.registered_at);
        if(row.event_kind!=='entry'||at===null||at<start||at>=end)return false;
        const sameDriver=row.driver_id && row.driver_id===session.entry.driver_id;
        const plate=plateKey(row.vehicle_plate);
        const sameVehicle=(row.vehicle_id && row.vehicle_id===session.entry.vehicle_id) || (plate && plate===plateKey(session.entry.vehicle_plate));
        return (sameDriver && !sameVehicle) || (sameVehicle && row.driver_id!==session.entry.driver_id);
      });
      if(conflict)session.flags.push('conflicting_entry');
    }
    for (let i=0;i<result.length;i++) for(let j=i+1;j<result.length;j++) {
      const a=result[i],b=result[j];
      if (a.entry&&a.exit&&b.entry&&b.exit&&a.entry.driver_id===b.entry.driver_id && timestamp(a.entry.registered_at)<timestamp(b.exit.registered_at)&&timestamp(b.entry.registered_at)<timestamp(a.exit.registered_at)) {
        if(!a.flags.includes('overlapping_shift'))a.flags.push('overlapping_shift');
        if(!b.flags.includes('overlapping_shift'))b.flags.push('overlapping_shift');
      }
    }
    return result.sort((a,b)=>(timestamp(a.entry?.registered_at||a.exit?.registered_at)??Infinity)-(timestamp(b.entry?.registered_at||b.exit?.registered_at)??Infinity));
  }
  function reading(trips, plate, target, toleranceMs=15*60000) {
    const time=timestamp(target);if(time===null)return null;
    const candidates=[],seen=new Set();
    for(const trip of trips) {
      if(plateKey(trip.registration)!==plateKey(plate))continue;
      for(const [date,value] of [[trip.start,trip.startOdometerKm],[trip.end,trip.endOdometerKm]]) {
        const at=timestamp(date);
        if(at===null||typeof value!=='number'||!Number.isFinite(value)||value<0||Math.abs(at-time)>toleranceMs)continue;
        const key=`${at}|${value}`;if(seen.has(key))continue;seen.add(key);
        candidates.push({at,km:value,gapSeconds:Math.abs(at-time)/1000});
      }
    }
    candidates.sort((a,b)=>a.gapSeconds-b.gapSeconds||a.at-b.at);
    if(!candidates.length)return null;
    if(candidates[1]?.gapSeconds===candidates[0].gapSeconds && (candidates[1].km!==candidates[0].km||candidates[1].at!==candidates[0].at))return null;
    return candidates[0];
  }
  function mileage(session,trips,partial=false) {
    if(partial||session.flags.length||!session.entry||!session.exit)return {start:null,end:null,distance:null,reason:partial?'partial_history':'incomplete_shift'};
    const start=reading(trips,session.entry.vehicle_plate,session.entry.registered_at);
    const end=reading(trips,session.exit.vehicle_plate,session.exit.registered_at);
    if(!start||!end)return {start,end,distance:null,reason:'missing_reading'};
    if(end.at<=start.at||end.km<start.km)return {start,end,distance:null,reason:'inconsistent_readings'};
    return {start,end,distance:end.km-start.km,reason:null};
  }
  const api={sessions,reading,mileage,timestamp};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ShiftMileage=api;
})(typeof globalThis==='undefined'?this:globalThis);

