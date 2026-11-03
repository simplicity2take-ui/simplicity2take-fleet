-- Read-only preflight for 20261030240000_platform_import_company_scope.sql.
-- SELECT-only. Run against a disposable/staging database before applying the draft.

-- 1. Company ownership columns and null coverage.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'platform_activity_events','platform_trip_records',
    'uber_driver_activity','uber_driver_payments','uber_driver_quality',
    'uber_driver_time_distance','uber_vehicle_performance','uber_vehicle_time_distance'
  )
  and column_name = 'company_id'
order by table_name;

select 'platform_activity_events' as table_name,
       count(*) as total_rows,
       count(*) filter (where company_id is null) as missing_company_id
from public.platform_activity_events
union all
select 'platform_trip_records', count(*), count(*) filter (where company_id is null)
from public.platform_trip_records
union all
select 'uber_driver_activity', count(*), count(*) filter (where company_id is null)
from public.uber_driver_activity
union all
select 'uber_driver_payments', count(*), count(*) filter (where company_id is null)
from public.uber_driver_payments
union all
select 'uber_driver_quality', count(*), count(*) filter (where company_id is null)
from public.uber_driver_quality
union all
select 'uber_driver_time_distance', count(*), count(*) filter (where company_id is null)
from public.uber_driver_time_distance
union all
select 'uber_vehicle_performance', count(*), count(*) filter (where company_id is null)
from public.uber_vehicle_performance
union all
select 'uber_vehicle_time_distance', count(*), count(*) filter (where company_id is null)
from public.uber_vehicle_time_distance;

-- 2. Existing globally unique conflict keys. Keep these in mind: an UPSERT
-- must include a tenant guard in its DO UPDATE WHERE clause.
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'platform_activity_events','platform_trip_records',
    'uber_driver_activity','uber_driver_payments','uber_driver_quality',
    'uber_driver_time_distance','uber_vehicle_performance','uber_vehicle_time_distance'
  )
  and indexdef ilike '%unique%'
order by tablename, indexname;

-- 3. RPC security posture.
select
  p.proname,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  pg_get_userbyid(p.proowner) as owner,
  coalesce(array_to_string(p.proacl, ', '), '(default ACL)') as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'sync_bolt_activity','sync_uber_driver_status','sync_uber_driver_activity',
    'sync_uber_vehicle_performance','sync_uber_vehicle_time_distance',
    'sync_uber_driver_time_distance','sync_uber_driver_quality',
    'sync_uber_driver_payments'
  )
order by p.proname;

-- 4. Identity collisions within the S2T tenant (must be resolved before enabling
-- any company-member write workflow).
select 'bolt_driver_uuid' as identity, bolt_driver_uuid as value, count(*) as matches
from public.drivers
where bolt_driver_uuid is not null
group by bolt_driver_uuid having count(*) > 1
union all
select 'bolt_vehicle_uuid', bolt_vehicle_uuid, count(*)
from public.vehicles
where bolt_vehicle_uuid is not null
group by bolt_vehicle_uuid having count(*) > 1;
