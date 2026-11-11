(function(root){
 'use strict';
 const stamp=value=>typeof value==='string'&&/(Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value)?Date.parse(value.replace(' ','T').replace(/([+-]\d{2})$/,'$1:00')):NaN;
 const plate=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 function qrToken(value,origin){
   const text=String(value||'').trim();
   if(/^[a-f0-9]{32}$/i.test(text))return text;
   try{const url=new URL(text,origin);if(url.origin!==new URL(origin).origin)return '';const token=url.searchParams.get('vehicle')||'';return /^[a-f0-9]{32}$/i.test(token)?token:'';}catch{return '';}
 }
 function session(shift){
   const event=(kind,at)=>({driver_id:shift.driver_id,vehicle_id:shift.vehicle_id,driver_name:shift.driver_name,vehicle_plate:shift.vehicle_plate,event_kind:kind,registered_at:at});
   const duration=stamp(shift.ended_at)-stamp(shift.started_at);
   const flags=!shift.ended_at?['missing_exit']:!Number.isFinite(duration)||duration<=0||duration>36*3600000?['invalid_or_long_shift']:[];
   return {entry:event('entry',shift.started_at),exit:shift.ended_at?event('exit',shift.ended_at):null,flags};
 }
 function reviewTrips(shift,trips,driver,partial=false){
   const flags=new Set(['platform_coverage_unconfirmed']),counts={uber:0,bolt:0};
   const start=stamp(shift.started_at),end=stamp(shift.ended_at);let conflicts=0;
   if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return {state:'pending',flags:['incomplete_shift'],counts};
   if(end-start>36*3600000||end===start){flags.add('shift_duration_review');conflicts++;}
   if(partial)flags.add('partial_trip_history');
   const seen=new Set();
   for(const t of trips){
     if(!['uber','bolt'].includes(t.platform))continue;
     const key=t.platform+'|'+t.source_trip_id;if(seen.has(key))continue;seen.add(key);
     const uuid=t.platform==='uber'?driver.uber_driver_uuid:driver.bolt_driver_uuid;
     const own=t.driver_id===shift.driver_id||Boolean(uuid&&t.platform_driver_uuid===uuid);
     const sameVehicle=t.vehicle_id===shift.vehicle_id||Boolean(plate(t.vehicle_plate)&&plate(t.vehicle_plate)===plate(shift.vehicle_plate));
     const a=stamp(t.accepted_at||t.pickup_at||t.finished_at||t.dropoff_at),b=stamp(t.finished_at||t.dropoff_at||t.pickup_at||t.accepted_at);
     if(!Number.isFinite(a)||!Number.isFinite(b)){if(own)flags.add('undated_driver_trips');continue;}
     if(a>end||b<start||(!own&&!sameVehicle))continue;
     if(own){counts[t.platform]++;if(!sameVehicle){flags.add('trip_vehicle_mismatch');conflicts++;}}
     if(sameVehicle&&!own){flags.add(t.driver_id||t.platform_driver_uuid?'trip_driver_mismatch':'trip_driver_unconfirmed');conflicts++;}
     if(own&&sameVehicle&&(a<start-300000||b>end+300000)){flags.add('trip_crosses_shift_boundary');conflicts++;}
   }
   return {state:conflicts?'review':partial||(!counts.uber&&!counts.bolt)?'pending':'checked_available_data',flags:[...flags],counts};
 }
 const api={qrToken,session,reviewTrips};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.NativeShifts=api;
})(typeof globalThis==='undefined'?this:globalThis);
