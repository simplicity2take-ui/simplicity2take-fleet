-- Read-only preflight for 20261030230000_company_fleet_rls.sql.
-- Run in Supabase SQL Editor only against a disposable/staging database first.
-- This script performs SELECTs only.

-- 1. Required columns and RLS state.
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('drivers', 'vehicles', 'vehicle_assignments')
order by c.relname;

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name in ('drivers', 'vehicles') and column_name in ('id', 'company_id', 'profile_id'))
    or (table_name = 'vehicle_assignments' and column_name in ('id', 'driver_id', 'vehicle_id', 'active'))
  )
order by table_name, ordinal_position;

-- 2. Existing policies (check for additional permissive policies not covered by the draft).
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('drivers', 'vehicles', 'vehicle_assignments')
order by tablename, policyname;

-- 3. Cross-company, orphaned and missing-parent assignments.
select
  count(*) filter (where d.id is null) as assignments_without_driver,
  count(*) filter (where v.id is null) as assignments_without_vehicle,
  count(*) filter (
    where d.id is not null and v.id is not null
      and (d.company_id is null or v.company_id is null or d.company_id <> v.company_id)
  ) as assignments_with_company_mismatch
from public.vehicle_assignments va
left join public.drivers d on d.id = va.driver_id
left join public.vehicles v on v.id = va.vehicle_id;

-- 4. Ownership coverage.
select 'drivers' as table_name,
       count(*) as total_rows,
       count(*) filter (where company_id is null) as missing_company_id
from public.drivers
union all
select 'vehicles',
       count(*),
       count(*) filter (where company_id is null)
from public.vehicles;

-- 5. Duplicate active assignments (informational; schema-specific active semantics).
select driver_id, count(*) as active_assignment_count
from public.vehicle_assignments
where coalesce(active, true) = true
group by driver_id
having count(*) > 1
order by active_assignment_count desc;
