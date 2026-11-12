'use strict';
// Offline preparation only. Database execution remains with the authorized Supabase connector.
const {createHash}=require('node:crypto');
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const plate=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const hash=v=>createHash('sha256').update(v).digest('hex');
function parseCsv(text){
  text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false,closed=false;
  const push=()=>{row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';closed=false;};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quoted=false;closed=true;}else cell+=c;continue;}
    if(closed&&![',','\r','\n'].includes(c))throw Error('invalid_csv_quotes');
    if(c==='"'){if(cell)throw Error('invalid_csv_quotes');quoted=true;}
    else if(c===','){row.push(cell);cell='';closed=false;}
    else if(c==='\r'||c==='\n'){push();if(c==='\r'&&text[i+1]==='\n')i++;}
    else cell+=c;
  }
  if(quoted)throw Error('unclosed_csv_quote');if(cell||row.length||closed)push();
  if(rows.length<2)throw Error('empty_report');const headers=rows.shift().map(h=>h.trim());
  if(new Set(headers).size!==headers.length||headers.some(h=>!h))throw Error('duplicate_or_empty_headers');
  const required=['UUID da viagem','UUID do motorista','UUID do veículo','Matrícula','Estado da viagem','Hora do pedido de viagem','Hora de chegada da viagem','Distância da viagem'];
  if(required.some(h=>!headers.includes(h)))throw Error('unsupported_trip_report');
  if(rows.length>5000||rows.some(r=>r.length!==headers.length))throw Error('invalid_report_shape');
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i].trim()])));
}
const lisbon=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function localTimestamp(value){
  if(!value)return null;
  const m=String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})?$/);
  if(!m)throw Error('invalid_timestamp');const [y,mo,d,h,mi,s]=m.slice(1,7).map(Number),base=Date.UTC(y,mo-1,d,h,mi,s);
  if(new Date(base).toISOString().slice(0,19)!==`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`)throw Error('invalid_timestamp');
  if(m[7]){const offset=m[7];if(offset!=='Z'&&(+offset.slice(1,3)>14||+offset.slice(4)>59||(+offset.slice(1,3)===14&&+offset.slice(4)!==0)))throw Error('invalid_timestamp');const at=Date.parse(value.replace(' ','T'));if(!Number.isFinite(at))throw Error('invalid_timestamp');return new Date(at).toISOString();}
  const wanted=m.slice(1,7).join('-');const candidates=[base,base-3600000].filter(at=>{const p=Object.fromEntries(lisbon.formatToParts(new Date(at)).map(x=>[x.type,x.value]));return [p.year,p.month,p.day,p.hour,p.minute,p.second].join('-')===wanted;});
  if(candidates.length!==1)throw Error(candidates.length?'ambiguous_local_time':'nonexistent_local_time');return new Date(candidates[0]).toISOString();
}
function mappingHash(drivers,vehicles){return hash(JSON.stringify({drivers:drivers.map(d=>[d.id,d.uber_driver_uuid||null]).sort(),vehicles:vehicles.map(v=>[v.id,v.uber_vehicle_uuid||null,plate(v.plate)]).sort()}));}
function prepareReport(bytes,{drivers,vehicles,source,now=Date.now()}){
  const buf=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes,'utf8'),text=buf.toString('utf8');
  if(!buf.length||buf.length>10*1024*1024||!Buffer.from(text,'utf8').equals(buf))throw Error('invalid_file_bytes');
  if(source?.original_upload!==true||!/^libfile[_-]/.test(source.library_file_id||'')||!/^file[_-]/.test(source.file_id||''))throw Error('original_library_upload_required');
  if(!Array.isArray(drivers)||!Array.isArray(vehicles))throw Error('identity_snapshot_required');
  const rows=parseCsv(text),records=[],rejections=[],seen=new Map(),conflicts=new Set(),invalidIds=new Set();let duplicates=0;
  const known=(list,key,value)=>list.filter(x=>x[key]===value);
  rows.forEach((r,i)=>{
    const id=r['UUID da viagem'];
    try{
      const du=r['UUID do motorista'],vu=r['UUID do veículo'],p=r['Matrícula'],status=r['Estado da viagem'].toLowerCase();
      if(!uuid.test(id)||!uuid.test(du)||!status||!/^[a-z_]{1,80}$/.test(status))throw Error('invalid_trip_identity_or_status');
      const ds=known(drivers,'uber_driver_uuid',du);if(ds.length!==1||!uuid.test(ds[0].id))throw Error('driver_identity_unconfirmed');
      let vehicleId=null;
      if(vu||p){const vs=known(vehicles,'uber_vehicle_uuid',vu);if(!uuid.test(vu)||vs.length!==1||!uuid.test(vs[0].id)||!plate(p)||plate(vs[0].plate)!==plate(p)||vehicles.filter(v=>plate(v.plate)===plate(p)).length!==1)throw Error('vehicle_identity_unconfirmed');vehicleId=vs[0].id;}
      else if(status==='completed')throw Error('vehicle_identity_unconfirmed');
      const requested=localTimestamp(r['Hora do pedido de viagem']),arrived=localTimestamp(r['Hora de chegada da viagem']);
      if(!requested&&!arrived)throw Error('missing_source_timestamp');
      if(requested&&arrived&&arrived<requested)throw Error('reversed_source_times');
      if([requested,arrived].some(t=>t&&Date.parse(t)>now+15*60000))throw Error('future_source_time');
      const raw=r['Distância da viagem'];if(raw&&(!/^\d+(?:[.,]\d+)?$/.test(raw)||!Number.isFinite(Number(raw.replace(',','.')))))throw Error('invalid_source_distance');
      const record={platform:'uber',source_trip_id:id,driver_id:ds[0].id,vehicle_id:vehicleId,platform_driver_uuid:du,platform_vehicle_uuid:vu||null,vehicle_plate:p||null,order_status:status,accepted_at:null,pickup_at:null,dropoff_at:status==='completed'?arrived:null,finished_at:status==='completed'?arrived:null,ride_distance_km:raw?Number(raw.replace(',','.')):null,observed_at:arrived||requested};
      if(status==='completed'&&!arrived)throw Error('missing_completed_service_end');
      const previous=seen.get(id);
      if(invalidIds.has(id))conflicts.add(id);
      if(previous){if(JSON.stringify(previous.record)!==JSON.stringify(record)){conflicts.add(id);rejections.push({row:i+2,source_trip_id:id,reason:'conflicting_duplicate_trip'});}else duplicates++;}
      else seen.set(id,{record,row:i+2});
    }catch(e){if(uuid.test(id||'')){invalidIds.add(id);if(seen.has(id))conflicts.add(id);}rejections.push({row:i+2,source_trip_id:uuid.test(id||'')?id:null,reason:e.message});}
  });
  for(const [id,v] of seen){if(conflicts.has(id))rejections.push({row:v.row,source_trip_id:id,reason:'conflicting_duplicate_trip'});else records.push(v.record);}
  return {meta:{source:{library_file_id:source.library_file_id,file_id:source.file_id,file_name:String(source.file_name||'').slice(0,250)},sha256:hash(buf),mapping_sha256:mappingHash(drivers,vehicles),timezone:'Europe/Lisbon',source_rows:rows.length,unique_prepared:records.length,duplicate_rows:duplicates,rejected_rows:rejections.length,coverage_verified:false},records,rejections};
}
const literal=value=>"'"+JSON.stringify(value).replace(/'/g,"''")+"'::jsonb";
function buildInsertSql(prepared){
  if(!/^[a-f0-9]{64}$/.test(prepared.meta?.sha256||'')||!/^[a-f0-9]{64}$/.test(prepared.meta?.mapping_sha256||'')||!Array.isArray(prepared.records)||!Array.isArray(prepared.rejections)||prepared.records.length>5000||prepared.meta.unique_prepared!==prepared.records.length||prepared.meta.rejected_rows!==prepared.rejections.length)throw Error('invalid_prepared_report');
  return `with input as (select * from jsonb_to_recordset(${literal(prepared.records)}) x(platform text,source_trip_id text,driver_id uuid,vehicle_id uuid,platform_driver_uuid text,platform_vehicle_uuid text,vehicle_plate text,order_status text,accepted_at timestamptz,pickup_at timestamptz,dropoff_at timestamptz,finished_at timestamptz,ride_distance_km numeric,observed_at timestamptz)),valid as materialized(select i.* from input i where i.platform='uber' and (select count(*) from public.drivers d where d.uber_driver_uuid=i.platform_driver_uuid)=1 and exists(select 1 from public.drivers d where d.id=i.driver_id and d.uber_driver_uuid=i.platform_driver_uuid) and ((i.vehicle_id is null and i.platform_vehicle_uuid is null and i.vehicle_plate is null and i.order_status<>'completed') or (exists(select 1 from public.vehicles v where v.id=i.vehicle_id and v.uber_vehicle_uuid=i.platform_vehicle_uuid and regexp_replace(upper(v.plate),'[^A-Z0-9]','','g')=regexp_replace(upper(i.vehicle_plate),'[^A-Z0-9]','','g')) and (select count(*) from public.vehicles v where v.uber_vehicle_uuid=i.platform_vehicle_uuid)=1 and (select count(*) from public.vehicles v where regexp_replace(upper(v.plate),'[^A-Z0-9]','','g')=regexp_replace(upper(i.vehicle_plate),'[^A-Z0-9]','','g'))=1))),existing_conflicts as(select i.source_trip_id from valid i join public.platform_trip_records t on t.platform='uber' and t.source_trip_id=i.source_trip_id where t.driver_id is distinct from i.driver_id or t.platform_driver_uuid is distinct from i.platform_driver_uuid or (i.vehicle_id is not null and (t.vehicle_id is distinct from i.vehicle_id or t.platform_vehicle_uuid is distinct from i.platform_vehicle_uuid or regexp_replace(upper(t.vehicle_plate),'[^A-Z0-9]','','g') is distinct from regexp_replace(upper(i.vehicle_plate),'[^A-Z0-9]','','g'))) or t.order_status is distinct from i.order_status or (i.finished_at is not null and t.finished_at is distinct from i.finished_at) or (i.dropoff_at is not null and t.dropoff_at is distinct from i.dropoff_at) or (i.ride_distance_km is not null and t.ride_distance_km is distinct from i.ride_distance_km)),prior as(select 1 from public.audit_log a where a.action='uber_library_trip_report_imported' and a.details->>'sha256'=${"'"+prepared.meta.sha256+"'"} and a.details->>'all_rows_accounted'='true'),inserted as(insert into public.platform_trip_records(platform,source_trip_id,driver_id,vehicle_id,platform_driver_uuid,platform_vehicle_uuid,vehicle_plate,order_status,accepted_at,pickup_at,dropoff_at,finished_at,ride_distance_km,observed_at) select * from valid where not exists(select 1 from prior) on conflict(platform,source_trip_id) do nothing returning id),summary as(select ${literal(prepared.meta)} || jsonb_build_object('inserted',(select count(*) from inserted),'live_identity_rejections',(select count(*) from input)-(select count(*) from valid),'existing_conflicts',(select count(*) from existing_conflicts),'rejections',${literal(prepared.rejections)},'all_rows_accounted',${prepared.rejections.length===0?'true':'false'} and (select count(*) from input)=(select count(*) from valid) and not exists(select 1 from existing_conflicts),'driver_states_changed',false,'assignments_changed',false) details),logged as(insert into public.audit_log(action,entity_type,details) select 'uber_library_trip_report_imported','platform_trip_records',details from summary where not exists(select 1 from prior) and not exists(select 1 from public.audit_log a where a.action='uber_library_trip_report_imported' and a.details->>'sha256'=${"'"+prepared.meta.sha256+"'"} and a.details->>'mapping_sha256'=${"'"+prepared.meta.mapping_sha256+"'"} and a.details->>'inserted'='0' and (select count(*) from inserted)=0) returning id,details) select id,details from logged;`;
}
module.exports={parseCsv,localTimestamp,prepareReport,mappingHash,buildInsertSql};
