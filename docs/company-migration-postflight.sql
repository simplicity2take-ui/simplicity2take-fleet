-- Simplicity2Take Fleet — post-migration validation (READ-ONLY)
-- Run only in a disposable Supabase development database after applying both draft company migrations.
-- Do not run this against production. SELECT statements only; no data is changed.

-- The expected company slug must resolve to exactly one row.
select slug, count(*) as rows_for_slug
from public.companies
where slug = 'simplicity2take'
group by slug;

-- Confirm backfill completed and compare these counts with the pre-migration baseline.
select 'drivers' as table_name, count(*) as total_rows,
       count(*) filter (where company_id is null) as null_company_rows
from public.drivers
union all
select 'vehicles', count(*),
       count(*) filter (where company_id is null)
from public.vehicles;

-- Assignment guard precondition: confirm both columns are NOT NULL at the schema level.
select table_name, column_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'vehicle_assignments'
  and column_name in ('driver_id', 'vehicle_id')
order by column_name;

-- Existing assignments must not cross current company ownership.
select count(*) as cross_company_assignments
from public.vehicle_assignments a
join public.drivers d on d.id = a.driver_id
join public.vehicles v on v.id = a.vehicle_id
where d.company_id is distinct from v.company_id;

-- Report any assignment whose driver or vehicle reference is missing.
select
  count(*) filter (where a.driver_id is null) as null_driver_assignments,
  count(*) filter (where a.vehicle_id is null) as null_vehicle_assignments
from public.vehicle_assignments a;

-- Verify RLS is enabled on the company and membership tables; this does not prove policies are correct.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('companies', 'company_memberships', 'drivers', 'vehicles', 'vehicle_assignments')
order by c.relname;

-- List relevant constraints after migration.
select tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on kcu.constraint_schema = tc.constraint_schema
 and kcu.constraint_name = tc.constraint_name
 and kcu.table_name = tc.table_name
where tc.constraint_schema = 'public'
  and tc.table_name in ('companies', 'company_memberships', 'drivers', 'vehicles', 'vehicle_assignments')
order by tc.table_name, tc.constraint_type, tc.constraint_name, kcu.ordinal_position;
