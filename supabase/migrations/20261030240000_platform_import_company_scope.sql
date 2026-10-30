-- Simplicity2Take Fleet — company ownership for platform imports + Bolt RPC hardening.
-- DRAFT ONLY. Requires company foundation + membership migrations first.
-- Do not apply until tested on a disposable database and the Uber RPC migration is ready.
--
-- Existing platform and Uber report rows are historical records of the sole configured
-- integration tenant. They are therefore backfilled to the fixed S2T company.
-- This migration deliberately leaves company_id nullable on the legacy Uber report tables
-- until all seven Uber RPCs are replaced. The platform tables become mandatory tenant rows
-- for new Bolt writes; the Uber direct-import path must be updated before tightening its columns.
-- It does not grant browser access or change RLS policies.

do $block$
begin
  if not exists (select 1 from public.companies where slug = 'simplicity2take') then
    raise exception 'Missing trusted company row: simplicity2take';
  end if;
end;
$block$;

alter table public.platform_activity_events
  add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.platform_trip_records
  add column if not exists company_id uuid references public.companies(id) on delete restrict;

alter table public.uber_driver_activity
  add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.uber_driver_payments
  add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.uber_driver_quality
  add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.uber_driver_time_distance
  add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.uber_vehicle_performance
  add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.uber_vehicle_time_distance
  add column if not exists company_id uuid references public.companies(id) on delete restrict;

-- Historical data belongs to the only currently configured provider tenant.
update public.platform_activity_events
set company_id = (select id from public.companies where slug = 'simplicity2take')
where company_id is null;
update public.platform_trip_records
set company_id = (select id from public.companies where slug = 'simplicity2take')
where company_id is null;

update public.uber_driver_activity
set company_id = (select id from public.companies where slug = 'simplicity2take')
where company_id is null;
update public.uber_driver_payments
set company_id = (select id from public.companies where slug = 'simplicity2take')
where company_id is null;
update public.uber_driver_quality
set company_id = (select id from public.companies where slug = 'simplicity2take')
where company_id is null;
update public.uber_driver_time_distance
set company_id = (select id from public.companies where slug = 'simplicity2take')
where company_id is null;
update public.uber_vehicle_performance
set company_id = (select id from public.companies where slug = 'simplicity2take')
where company_id is null;
update public.uber_vehicle_time_distance
set company_id = (select id from public.companies where slug = 'simplicity2take')
where company_id is null;


-- All existing rows have been backfilled above; future platform writes must name a tenant.
alter table public.platform_activity_events alter column company_id set not null;
alter table public.platform_trip_records alter column company_id set not null;

-- Replace legacy global provider keys with tenant-scoped keys.
drop index if exists public.platform_activity_events_event_key_key;
drop index if exists public.platform_trip_records_platform_source_trip_id_key;

create unique index if not exists platform_activity_events_company_event_key_uidx
  on public.platform_activity_events(company_id, event_key);
create unique index if not exists platform_trip_records_company_platform_trip_uidx
  on public.platform_trip_records(company_id, platform, source_trip_id);

create index if not exists platform_activity_events_company_observed_idx
  on public.platform_activity_events(company_id, observed_at desc);
create index if not exists platform_trip_records_company_observed_idx
  on public.platform_trip_records(company_id, observed_at desc);
create index if not exists uber_driver_activity_company_period_idx
  on public.uber_driver_activity(company_id, period_end desc);
create index if not exists uber_driver_payments_company_period_idx
  on public.uber_driver_payments(company_id, period_end desc);
create index if not exists uber_driver_quality_company_period_idx
  on public.uber_driver_quality(company_id, period_end desc);
create index if not exists uber_driver_time_distance_company_period_idx
  on public.uber_driver_time_distance(company_id, period_end desc);
create index if not exists uber_vehicle_performance_company_period_idx
  on public.uber_vehicle_performance(company_id, period_end desc);
create index if not exists uber_vehicle_time_distance_company_period_idx
  on public.uber_vehicle_time_distance(company_id, period_end desc);

-- Bolt provider import is S2T-only for now. Resolve the tenant internally,
-- scope every identity lookup, and make cross-tenant unique-key conflicts no-ops.
create or replace function public.sync_bolt_activity(p_events jsonb, p_trips jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  event_count integer := 0;
  trip_count integer := 0;
  s2t_company_id uuid;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;

  select id into s2t_company_id
  from public.companies
  where slug = 'simplicity2take' and status = 'Ativa'
  limit 1;

  if s2t_company_id is null then
    raise exception 'Simplicity2Take company is not configured';
  end if;

  insert into public.platform_activity_events (
    company_id, platform, driver_id, vehicle_id, platform_driver_uuid,
    platform_vehicle_uuid, status, observed_at, event_key
  )
  select
    s2t_company_id,
    'bolt',
    d.id,
    v.id,
    nullif(e->>'driver_uuid',''),
    nullif(e->>'vehicle_uuid',''),
    coalesce(nullif(e->>'state',''),'UNKNOWN'),
    (e->>'created_at')::timestamptz,
    e->>'event_key'
  from jsonb_array_elements(coalesce(p_events,'[]'::jsonb)) e
  left join public.drivers d
    on d.bolt_driver_uuid = nullif(e->>'driver_uuid','')
   and d.company_id = s2t_company_id
  left join public.vehicles v
    on v.bolt_vehicle_uuid = nullif(e->>'vehicle_uuid','')
   and v.company_id = s2t_company_id
  where nullif(e->>'event_key','') is not null
    and nullif(e->>'created_at','') is not null
  on conflict (company_id, event_key) do update set
    driver_id = excluded.driver_id,
    vehicle_id = excluded.vehicle_id,
    status = excluded.status,
    observed_at = excluded.observed_at
  where public.platform_activity_events.company_id = excluded.company_id;

  get diagnostics event_count = row_count;

  insert into public.platform_trip_records (
    company_id, platform, source_trip_id, driver_id, vehicle_id,
    platform_driver_uuid, platform_vehicle_uuid, vehicle_plate,
    order_status, accepted_at, pickup_at, dropoff_at, finished_at,
    ride_distance_km, observed_at
  )
  select
    s2t_company_id,
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
  left join public.drivers d
    on d.bolt_driver_uuid = nullif(t->>'driver_uuid','')
   and d.company_id = s2t_company_id
  left join public.vehicles v
    on (
      v.bolt_vehicle_uuid = nullif(t->>'vehicle_uuid','')
      or (
        v.bolt_vehicle_uuid is null
        and upper(v.plate) = upper(nullif(t->>'vehicle_plate',''))
      )
    )
   and v.company_id = s2t_company_id
  where nullif(t->>'source_trip_id','') is not null
  on conflict (company_id, platform, source_trip_id) do update set
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
    observed_at = excluded.observed_at
  where public.platform_trip_records.company_id = excluded.company_id;

  get diagnostics trip_count = row_count;

  return jsonb_build_object(
    'eventsUpserted', event_count,
    'tripsUpserted', trip_count
  );
end;
$function$;

revoke all on function public.sync_bolt_activity(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sync_bolt_activity(jsonb, jsonb) to service_role;

comment on function public.sync_bolt_activity(jsonb, jsonb) is
  'S2T-only Bolt import. Company-scoped identity resolution; cross-company unique-key conflicts are not updated.';
