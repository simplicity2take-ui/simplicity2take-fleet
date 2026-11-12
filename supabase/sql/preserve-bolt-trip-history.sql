CREATE OR REPLACE FUNCTION public.sync_bolt_activity(p_events jsonb, p_trips jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  event_count int := 0;
  trip_count int := 0;
begin
  -- Existing trip identity is immutable during unattended imports.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_trips,'[]'::jsonb)) t
    join public.platform_trip_records r on r.platform='bolt' and r.source_trip_id=t->>'source_trip_id'
    where (r.platform_driver_uuid is not null and nullif(t->>'driver_uuid','') is not null and r.platform_driver_uuid<>t->>'driver_uuid')
       or (r.platform_vehicle_uuid is not null and nullif(t->>'vehicle_uuid','') is not null and r.platform_vehicle_uuid<>t->>'vehicle_uuid')
       or (nullif(r.vehicle_plate,'') is not null and nullif(t->>'vehicle_plate','') is not null and upper(regexp_replace(r.vehicle_plate,'[^a-zA-Z0-9]','','g'))<>upper(regexp_replace(t->>'vehicle_plate','[^a-zA-Z0-9]','','g')))
       or (r.driver_id is not null and exists(select 1 from public.drivers d where d.bolt_driver_uuid=nullif(t->>'driver_uuid','') and d.id<>r.driver_id))
       or (r.vehicle_id is not null and exists(select 1 from public.vehicles v where (v.bolt_vehicle_uuid=nullif(t->>'vehicle_uuid','') or (v.bolt_vehicle_uuid is null and upper(v.plate)=upper(nullif(t->>'vehicle_plate','')))) and v.id<>r.vehicle_id))
  ) then raise exception 'BOLT_TRIP_IDENTITY_CONFLICT: review required; import not saved'; end if;
  insert into public.platform_activity_events (
    platform, driver_id, vehicle_id, platform_driver_uuid,
    platform_vehicle_uuid, status, observed_at, event_key
  )
  select
    'bolt',
    d.id,
    v.id,
    nullif(e->>'driver_uuid',''),
    nullif(e->>'vehicle_uuid',''),
    coalesce(nullif(e->>'state',''),'UNKNOWN'),
    (e->>'created_at')::timestamptz,
    e->>'event_key'
  from jsonb_array_elements(coalesce(p_events,'[]'::jsonb)) e
  left join public.drivers d on d.bolt_driver_uuid = nullif(e->>'driver_uuid','')
  left join public.vehicles v on v.bolt_vehicle_uuid = nullif(e->>'vehicle_uuid','')
  where nullif(e->>'event_key','') is not null
    and nullif(e->>'created_at','') is not null
  on conflict (event_key) do update set
    driver_id = excluded.driver_id,
    vehicle_id = excluded.vehicle_id,
    status = excluded.status,
    observed_at = excluded.observed_at;

  get diagnostics event_count = row_count;

  insert into public.platform_trip_records (
    platform, source_trip_id, driver_id, vehicle_id,
    platform_driver_uuid, platform_vehicle_uuid, vehicle_plate,
    order_status, accepted_at, pickup_at, dropoff_at, finished_at,
    ride_distance_km, observed_at
  )
  select
    'bolt',
    t->>'source_trip_id',
    d.id,
    v.id,
    nullif(t->>'driver_uuid',''),
    nullif(t->>'vehicle_uuid',''),
    nullif(t->>'vehicle_plate',''),
    nullif(t->>'order_status',''),
    nullif(t->>'accepted_at','')::timestamptz,
    nullif(t->>'pickup_at','')::timestamptz,
    nullif(t->>'dropoff_at','')::timestamptz,
    nullif(t->>'finished_at','')::timestamptz,
    nullif(t->>'ride_distance_km','')::numeric,
    coalesce(nullif(t->>'observed_at','')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_trips,'[]'::jsonb)) t
  left join public.drivers d on d.bolt_driver_uuid = nullif(t->>'driver_uuid','')
  left join public.vehicles v
    on v.bolt_vehicle_uuid = nullif(t->>'vehicle_uuid','')
    or (v.bolt_vehicle_uuid is null and upper(v.plate) = upper(nullif(t->>'vehicle_plate','')))
  where nullif(t->>'source_trip_id','') is not null
  on conflict (platform, source_trip_id) do update set
    driver_id = coalesce(excluded.driver_id, platform_trip_records.driver_id),
    vehicle_id = coalesce(excluded.vehicle_id, platform_trip_records.vehicle_id),
    platform_driver_uuid = coalesce(excluded.platform_driver_uuid, platform_trip_records.platform_driver_uuid),
    platform_vehicle_uuid = coalesce(excluded.platform_vehicle_uuid, platform_trip_records.platform_vehicle_uuid),
    vehicle_plate = coalesce(excluded.vehicle_plate, platform_trip_records.vehicle_plate),
    order_status = coalesce(excluded.order_status, platform_trip_records.order_status),
    accepted_at = coalesce(excluded.accepted_at, platform_trip_records.accepted_at),
    pickup_at = coalesce(excluded.pickup_at, platform_trip_records.pickup_at),
    dropoff_at = coalesce(excluded.dropoff_at, platform_trip_records.dropoff_at),
    finished_at = coalesce(excluded.finished_at, platform_trip_records.finished_at),
    ride_distance_km = coalesce(excluded.ride_distance_km, platform_trip_records.ride_distance_km),
    observed_at = excluded.observed_at
  where (platform_trip_records.platform_driver_uuid is null or excluded.platform_driver_uuid is null or platform_trip_records.platform_driver_uuid=excluded.platform_driver_uuid)
    and (platform_trip_records.platform_vehicle_uuid is null or excluded.platform_vehicle_uuid is null or platform_trip_records.platform_vehicle_uuid=excluded.platform_vehicle_uuid)
    and (platform_trip_records.driver_id is null or excluded.driver_id is null or platform_trip_records.driver_id=excluded.driver_id)
    and (platform_trip_records.vehicle_id is null or excluded.vehicle_id is null or platform_trip_records.vehicle_id=excluded.vehicle_id)
    and (nullif(platform_trip_records.vehicle_plate,'') is null or nullif(excluded.vehicle_plate,'') is null or upper(regexp_replace(platform_trip_records.vehicle_plate,'[^a-zA-Z0-9]','','g'))=upper(regexp_replace(excluded.vehicle_plate,'[^a-zA-Z0-9]','','g')));

  get diagnostics trip_count = row_count;
  if trip_count<>(select count(*) from jsonb_array_elements(coalesce(p_trips,'[]'::jsonb)) t where nullif(t->>'source_trip_id','') is not null)
  then raise exception 'BOLT_TRIP_IDENTITY_CONFLICT: concurrent change; import not saved'; end if;

  return jsonb_build_object(
    'eventsUpserted', event_count,
    'tripsUpserted', trip_count
  );
end;
$function$
