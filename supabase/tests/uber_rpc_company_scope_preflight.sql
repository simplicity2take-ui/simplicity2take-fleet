-- Read-only preflight for platform import and Uber RPC tenant migrations.
-- SELECT-only. Run only on disposable/staging after the company foundation is present.

-- 1. All historical platform/Uber tables must have company_id NOT NULL and no gaps.
select table_name, column_name, is_nullable
from information_schema.columns
where table_schema='public'
  and table_name in (
    'platform_activity_events','platform_trip_records',
    'uber_driver_activity','uber_driver_payments','uber_driver_quality',
    'uber_driver_time_distance','uber_vehicle_performance','uber_vehicle_time_distance'
  )
  and column_name='company_id'
order by table_name;

select 'platform_activity_events' as table_name, count(*) as rows_total,
       count(*) filter(where company_id is null) as rows_without_company
from public.platform_activity_events
union all select 'platform_trip_records',count(*),count(*) filter(where company_id is null) from public.platform_trip_records
union all select 'uber_driver_activity',count(*),count(*) filter(where company_id is null) from public.uber_driver_activity
union all select 'uber_driver_payments',count(*),count(*) filter(where company_id is null) from public.uber_driver_payments
union all select 'uber_driver_quality',count(*),count(*) filter(where company_id is null) from public.uber_driver_quality
union all select 'uber_driver_time_distance',count(*),count(*) filter(where company_id is null) from public.uber_driver_time_distance
union all select 'uber_vehicle_performance',count(*),count(*) filter(where company_id is null) from public.uber_vehicle_performance
union all select 'uber_vehicle_time_distance',count(*),count(*) filter(where company_id is null) from public.uber_vehicle_time_distance;

-- 2. Driver/vehicle references in report rows must either be null or point to
-- the same company as the report row.
select 'uber_driver_activity' as table_name, count(*) as mismatches
from public.uber_driver_activity r join public.drivers d on d.id=r.driver_id
where r.company_id is distinct from d.company_id
union all select 'uber_driver_payments',count(*) from public.uber_driver_payments r
join public.drivers d on d.id=r.driver_id where r.company_id is distinct from d.company_id
union all select 'uber_driver_quality',count(*) from public.uber_driver_quality r
join public.drivers d on d.id=r.driver_id where r.company_id is distinct from d.company_id
union all select 'uber_driver_time_distance',count(*) from public.uber_driver_time_distance r
join public.drivers d on d.id=r.driver_id where r.company_id is distinct from d.company_id
union all select 'uber_vehicle_performance',count(*) from public.uber_vehicle_performance r
join public.vehicles v on v.id=r.vehicle_id where r.company_id is distinct from v.company_id
union all select 'uber_vehicle_time_distance',count(*) from public.uber_vehicle_time_distance r
join public.vehicles v on v.id=r.vehicle_id where r.company_id is distinct from v.company_id;

-- 3. All eight import RPCs must be SECURITY DEFINER, have an empty search_path,
-- and remain executable only by service_role (plus owner implicit privileges).
select p.proname, p.prosecdef, p.proconfig,
       pg_get_userbyid(p.proowner) as owner,
       coalesce(array_to_string(p.proacl, ', '),'(default ACL)') as acl,
       pg_get_functiondef(p.oid) like '%company_id%' as definition_mentions_company
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
    'sync_bolt_activity','sync_uber_driver_status','sync_uber_driver_activity',
    'sync_uber_vehicle_performance','sync_uber_vehicle_time_distance',
    'sync_uber_driver_time_distance','sync_uber_driver_quality',
    'sync_uber_driver_payments'
  )
order by p.proname;

-- 4. Global unique conflict keys are expected to remain global. Review the
-- DO UPDATE WHERE tenant guard in each function definition before release.
select tablename,indexname,indexdef
from pg_indexes
where schemaname='public'
  and tablename in (
    'platform_activity_events','platform_trip_records',
    'uber_driver_activity','uber_driver_payments','uber_driver_quality',
    'uber_driver_time_distance','uber_vehicle_performance','uber_vehicle_time_distance'
  )
  and indexdef ilike '%unique%'
order by tablename,indexname;
