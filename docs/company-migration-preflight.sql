-- Simplicity2Take Fleet — company migration preflight (READ-ONLY)
-- Run manually ONLY against a disposable Supabase development database.
-- This script contains SELECT statements only. It does not apply migrations or mutate data.
-- Review output before testing the draft company migrations.

-- 1. Confirm required tables and the admin helper exist.
select
  to_regclass('public.profiles') as profiles_table,
  to_regclass('public.companies') as companies_table,
  to_regclass('public.drivers') as drivers_table,
  to_regclass('public.vehicles') as vehicles_table,
  to_regclass('public.vehicle_assignments') as assignments_table,
  to_regprocedure('public.s2t_is_admin()') as admin_helper;

-- 2. Inspect relevant columns and nullability before applying ownership/assignment constraints.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'drivers' and column_name in ('id', 'company_id', 'bolt_driver_uuid', 'email', 'phone'))
    or (table_name = 'vehicles' and column_name in ('id', 'company_id', 'plate', 'bolt_vehicle_uuid'))
    or (table_name = 'vehicle_assignments' and column_name in ('id', 'driver_id', 'vehicle_id', 'active_from', 'active_until'))
    or (table_name = 'profiles' and column_name = 'id')
  )
order by table_name, ordinal_position;

-- 3. Inspect current row counts and existing ownership distribution.
select 'drivers' as table_name, count(*) as total_rows,
       count(*) filter (where company_id is null) as null_company_rows
from public.drivers
union all
select 'vehicles', count(*),
       count(*) filter (where company_id is null)
from public.vehicles;

-- 4. Inspect company slug uniqueness and whether the expected company already exists.
-- If public.companies does not exist yet, this query is expected to fail; run it after
-- the first migration in a disposable database, not against production.
select slug, count(*) as rows_for_slug
from public.companies
where slug = 'simplicity2take'
group by slug;

-- 5. Check active assignment rows with missing driver or vehicle references.
-- This reports issues; it does not repair or delete anything.
select
  count(*) filter (where a.driver_id is null) as null_driver_assignments,
  count(*) filter (where a.vehicle_id is null) as null_vehicle_assignments,
  count(*) filter (where a.active_until is null) as active_assignment_rows
from public.vehicle_assignments a;

-- 6. After the company foundation migration is applied in a disposable database,
-- check assignment company mismatches and missing ownership. Before the migration,
-- these queries are expected to fail because company_id does not yet exist.
select count(*) as active_cross_company_assignments
from public.vehicle_assignments a
join public.drivers d on d.id = a.driver_id
join public.vehicles v on v.id = a.vehicle_id
where a.active_until is null
  and d.company_id is distinct from v.company_id;

select
  (select count(*) from public.drivers where company_id is null) as drivers_without_company,
  (select count(*) from public.vehicles where company_id is null) as vehicles_without_company;

-- 7. Inspect foreign keys and unique constraints relevant to safe idempotent sync.
select
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on kcu.constraint_schema = tc.constraint_schema
 and kcu.constraint_name = tc.constraint_name
 and kcu.table_name = tc.table_name
where tc.constraint_schema = 'public'
  and tc.table_name in ('companies', 'company_memberships', 'drivers', 'vehicles', 'vehicle_assignments')
order by tc.table_name, tc.constraint_type, tc.constraint_name, kcu.ordinal_position;

-- 8. Check whether the core data tables currently have RLS enabled.
select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'companies', 'company_memberships', 'profiles', 'drivers', 'vehicles',
    'vehicle_assignments', 'documents', 'document_viewers',
    'platform_activity_events', 'platform_trip_records',
    'cartrack_vehicles', 'cartrack_snapshots'
  )
order by c.relname;
