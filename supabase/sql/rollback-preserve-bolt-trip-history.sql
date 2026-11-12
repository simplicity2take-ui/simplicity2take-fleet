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
    driver_id = excluded.driver_id,
    vehicle_id = excluded.vehicle_id,
    platform_driver_uuid = excluded.platform_driver_uuid,
    platform_vehicle_uuid = excluded.platform_vehicle_uuid,
    vehicle_plate = excluded.vehicle_plate,
    order_status = excluded.order_status,
    accepted_at = excluded.accepted_at,
    pickup_at = excluded.pickup_at,
    dropoff_at = excluded.dropoff_at,
    finished_at = excluded.finished_at,
    ride_distance_km = excluded.ride_distance_km,
    observed_at = excluded.observed_at;

  get diagnostics trip_count = row_count;

  return jsonb_build_object(
    'eventsUpserted', event_count,
    'tripsUpserted', trip_count
  );
end;
$function$
