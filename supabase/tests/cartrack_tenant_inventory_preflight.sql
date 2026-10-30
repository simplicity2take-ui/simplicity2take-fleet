-- CarTrack tenant-scope inventory preflight.
-- READ-ONLY: catalog metadata and aggregate counts only. No row-level
-- registrations, provider IDs, credentials, payloads or personal data returned.
-- Safe for controlled review; never use this script to mutate production.

-- 1. Existing table shape, ownership candidates and types.
select table_name, ordinal_position, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'cartrack_vehicles',
    'cartrack_vehicle_snapshots',
    'vehicle_odometer_readings',
    'vehicles'
  )
order by table_name, ordinal_position;

-- 2. RLS state, policies and effective API-role privileges.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       r.rolname as role_name,
       has_table_privilege(r.rolname, c.oid, 'SELECT') as can_select,
       has_table_privilege(r.rolname, c.oid, 'INSERT') as can_insert,
       has_table_privilege(r.rolname, c.oid, 'UPDATE') as can_update,
       has_table_privilege(r.rolname, c.oid, 'DELETE') as can_delete,
       has_table_privilege(r.rolname, c.oid, 'TRUNCATE') as can_truncate
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join pg_roles r
where n.nspname = 'public'
  and c.relname in ('cartrack_vehicles', 'cartrack_vehicle_snapshots', 'vehicle_odometer_readings')
  and r.rolname in ('anon', 'authenticated', 'service_role')
order by c.relname, r.rolname;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('cartrack_vehicles', 'cartrack_vehicle_snapshots', 'vehicle_odometer_readings')
order by tablename, policyname;

-- 3. Constraints and indexes: determine whether provider IDs are external IDs
-- and whether telemetry has canonical Fleet foreign keys.
select c.relname as table_name, con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('cartrack_vehicles', 'cartrack_vehicle_snapshots', 'vehicle_odometer_readings')
order by c.relname, con.conname;

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('cartrack_vehicles', 'cartrack_vehicle_snapshots', 'vehicle_odometer_readings')
order by tablename, indexname;

-- 4. The existing writer is privileged code. Inspect its body, SECURITY mode,
-- search_path and EXECUTE grants before changing its contract.
select p.oid::regprocedure as signature,
       p.prosecdef as security_definer,
       p.proconfig as settings,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'sync_cartrack_data';

select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'sync_cartrack_data'
order by grantee, privilege_type;

-- 5. Return aggregate mapping quality only; never disclose registrations.
with mapping_quality as (
  select c.registration, count(v.id) as matches
  from public.cartrack_vehicles c
  left join public.vehicles v
    on upper(trim(v.plate)) = upper(trim(c.registration))
  group by c.registration
)
select count(*) as cartrack_vehicle_rows,
       count(*) filter (where matches = 0) as unmatched_rows,
       count(*) filter (where matches = 1) as uniquely_matched_rows,
       count(*) filter (where matches > 1) as ambiguous_rows,
       (select count(*) from public.vehicles) as fleet_vehicle_rows,
       (select count(*) from (
          select upper(trim(plate))
          from public.vehicles
          group by upper(trim(plate))
          having count(*) > 1
        ) duplicates) as duplicate_normalized_fleet_registrations
from mapping_quality;

-- 6. Check odometer source constraints and whether CarTrack can be recorded.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.vehicle_odometer_readings'::regclass
  and contype = 'c';

-- 7. Aggregate current data volumes only.
select
  (select count(*) from public.cartrack_vehicle_snapshots) as snapshot_rows,
  (select count(*) from public.vehicle_odometer_readings) as odometer_rows,
  (select count(*) from public.cartrack_vehicle_snapshots where vehicle_id is null) as snapshots_without_external_id;

-- 8. API roles must not be able to TRUNCATE telemetry tables. RLS does not
-- protect TRUNCATE; this is an explicit grant check, not a row-policy check.
select c.relname as table_name, r.rolname as role_name,
       has_table_privilege(r.rolname, c.oid, 'TRUNCATE') as can_truncate
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join pg_roles r
where n.nspname = 'public'
  and c.relname in ('cartrack_vehicles', 'cartrack_vehicle_snapshots', 'vehicle_odometer_readings')
  and r.rolname in ('anon', 'authenticated', 'service_role')
order by c.relname, r.rolname;
