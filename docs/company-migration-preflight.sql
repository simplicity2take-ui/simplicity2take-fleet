-- Simplicity2Take Fleet — pre-migration baseline (READ-ONLY)
-- Run only against a disposable Supabase development database before applying draft migrations.
-- SELECT statements only; this script does not mutate data.

-- Required dependencies expected by the draft migrations.
select
  to_regclass('public.profiles') as profiles_table,
  to_regclass('public.drivers') as drivers_table,
  to_regclass('public.vehicles') as vehicles_table,
  to_regclass('public.vehicle_assignments') as assignments_table,
  to_regprocedure('public.s2t_is_admin()') as admin_helper;

-- Baseline row counts. Save results to compare after migration.
select 'drivers' as table_name, count(*) as total_rows from public.drivers
union all
select 'vehicles', count(*) from public.vehicles
union all
select 'vehicle_assignments', count(*) from public.vehicle_assignments;

-- Assignment nullability and current constraints.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'drivers' and column_name in ('id', 'bolt_driver_uuid', 'email', 'phone'))
    or (table_name = 'vehicles' and column_name in ('id', 'plate', 'bolt_vehicle_uuid'))
    or (table_name = 'vehicle_assignments' and column_name in ('id', 'driver_id', 'vehicle_id', 'active_from', 'active_until'))
    or (table_name = 'profiles' and column_name = 'id')
  )
order by table_name, ordinal_position;

select
  count(*) filter (where driver_id is null) as null_driver_assignments,
  count(*) filter (where vehicle_id is null) as null_vehicle_assignments,
  count(*) filter (where active_until is null) as active_assignment_rows
from public.vehicle_assignments;

-- Existing uniqueness/foreign key constraints relevant to matching and assignments.
select tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on kcu.constraint_schema = tc.constraint_schema
 and kcu.constraint_name = tc.constraint_name
 and kcu.table_name = tc.table_name
where tc.constraint_schema = 'public'
  and tc.table_name in ('profiles', 'drivers', 'vehicles', 'vehicle_assignments')
order by tc.table_name, tc.constraint_type, tc.constraint_name, kcu.ordinal_position;

-- Existing RLS state for core tables.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'drivers', 'vehicles', 'vehicle_assignments')
order by c.relname;
