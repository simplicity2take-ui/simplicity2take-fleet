-- Simplicity2Take Fleet — company migration preflight checks
-- READ-ONLY: run against a disposable test database before applying draft migrations.
-- Do not use this file as evidence that production is safe; it intentionally performs no writes.

-- 1) Confirm required tables exist before the migration.
select required.table_name,
       (to_regclass('public.' || required.table_name) is not null) as exists
from (values
  ('companies'),
  ('drivers'),
  ('vehicles'),
  ('vehicle_assignments'),
  ('profiles')
) as required(table_name);

-- 2) Inspect assignment key nullability and constraints.
select c.table_name, c.column_name, c.is_nullable, c.data_type
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'vehicle_assignments'
  and c.column_name in ('driver_id', 'vehicle_id')
order by c.column_name;

select tc.constraint_name, tc.constraint_type, kcu.column_name
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on kcu.constraint_schema = tc.constraint_schema
 and kcu.constraint_name = tc.constraint_name
 and kcu.table_schema = tc.table_schema
where tc.table_schema = 'public'
  and tc.table_name = 'vehicle_assignments'
  and tc.constraint_type in ('FOREIGN KEY', 'CHECK', 'PRIMARY KEY', 'UNIQUE')
order by tc.constraint_type, tc.constraint_name, kcu.ordinal_position;

-- 3) Record baseline row counts before any migration.
select 'drivers' as table_name, count(*) as row_count from public.drivers
union all
select 'vehicles', count(*) from public.vehicles
union all
select 'vehicle_assignments', count(*) from public.vehicle_assignments;

-- 4) Check whether the global admin helper and profiles table exist.
select to_regprocedure('public.s2t_is_admin()') as admin_helper;
select to_regclass('public.profiles') as profiles_table;

-- 5) After company_id columns have been added in the disposable test environment,
-- use these checks to identify ownership gaps.
-- Uncomment only after the relevant migration has run in the disposable database:
-- select 'drivers_null_company' as check_name, count(*) as row_count
-- from public.drivers where company_id is null
-- union all
-- select 'vehicles_null_company', count(*)
-- from public.vehicles where company_id is null;

-- 6) After the ownership backfill, verify cross-company active assignments.
-- This check assumes vehicle_assignments has an active/status field. Adapt to the
-- actual schema in the disposable database before execution; do not guess the field.
-- select count(*) as cross_company_assignment_count
-- from public.vehicle_assignments a
-- join public.drivers d on d.id = a.driver_id
-- join public.vehicles v on v.id = a.vehicle_id
-- where d.company_id <> v.company_id;
