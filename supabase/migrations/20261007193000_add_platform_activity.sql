-- Simplicity2Take Fleet — platform activity storage
-- Stores only operational state/trip metrics. No GPS coordinates, addresses,
-- payments or telemetry are persisted.

create table if not exists public.platform_activity_events (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('bolt','uber')),
  driver_id uuid references public.drivers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  platform_driver_uuid text,
  platform_vehicle_uuid text,
  status text not null,
  observed_at timestamptz not null,
  event_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists platform_activity_events_lookup_idx
  on public.platform_activity_events(platform, observed_at desc);
create index if not exists platform_activity_events_vehicle_idx
  on public.platform_activity_events(vehicle_id, observed_at desc);
create index if not exists platform_activity_events_driver_idx
  on public.platform_activity_events(driver_id, observed_at desc);

create table if not exists public.platform_trip_records (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('bolt','uber')),
  source_trip_id text not null,
  driver_id uuid references public.drivers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  platform_driver_uuid text,
  platform_vehicle_uuid text,
  vehicle_plate text,
  order_status text,
  accepted_at timestamptz,
  pickup_at timestamptz,
  dropoff_at timestamptz,
  finished_at timestamptz,
  ride_distance_km numeric(12,3),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(platform, source_trip_id)
);

create index if not exists platform_trip_records_lookup_idx
  on public.platform_trip_records(platform, coalesce(finished_at, accepted_at, observed_at) desc);
create index if not exists platform_trip_records_vehicle_idx
  on public.platform_trip_records(vehicle_id, coalesce(finished_at, accepted_at, observed_at) desc);
create index if not exists platform_trip_records_driver_idx
  on public.platform_trip_records(driver_id, coalesce(finished_at, accepted_at, observed_at) desc);

alter table public.platform_activity_events enable row level security;
alter table public.platform_trip_records enable row level security;

drop policy if exists "s2t_platform_activity_admin_or_assigned" on public.platform_activity_events;
create policy "s2t_platform_activity_admin_or_assigned"
on public.platform_activity_events for select
using (public.s2t_is_admin() or driver_id = public.s2t_driver_id());

drop policy if exists "s2t_platform_trips_admin_or_assigned" on public.platform_trip_records;
create policy "s2t_platform_trips_admin_or_assigned"
on public.platform_trip_records for select
using (public.s2t_is_admin() or driver_id = public.s2t_driver_id());

revoke all on public.platform_activity_events from anon, authenticated;
revoke all on public.platform_trip_records from anon, authenticated;
grant select on public.platform_activity_events to authenticated;
grant select on public.platform_trip_records to authenticated;

create or replace function public.sync_bolt_activity(
  p_events jsonb,
  p_trips jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  return jsonb_build_object('eventsUpserted', event_count, 'tripsUpserted', trip_count);
end;
$$;

revoke all on function public.sync_bolt_activity(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.sync_bolt_activity(jsonb,jsonb) to service_role;
