-- Simplicity2Take Fleet — security preflight for company rollout
-- READ-ONLY diagnostics. Run only in a disposable PostgreSQL/Supabase environment
-- after both company migrations have been applied there. No data is modified.

-- 1) SECURITY DEFINER functions must pin search_path. Review any returned rows.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.proconfig as function_settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and not coalesce(p.proconfig @> array['search_path=""'], false)
order by p.proname;

-- 2) Confirm the company/identity helper functions exist and show effective ACLs.
select
  p.oid::regprocedure as function_signature,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  coalesce(array_to_string(p.proacl, ', '), '(default ACL)') as function_acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    's2t_is_admin',
    's2t_driver_id',
    's2t_is_company_member',
    's2t_is_company_admin',
    's2t_guard_assignment_company',
    'sync_bolt_activity'
  )
order by p.proname;

-- 3) Verify the core company-owned tables have RLS enabled.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'companies', 'company_memberships', 'drivers', 'vehicles',
    'vehicle_assignments', 'documents', 'document_viewers',
    'platform_activity_events', 'platform_trip_records'
  )
order by c.relname;

-- 4) List policies for the tables that must become tenant-scoped.
-- This is diagnostic, not a pass/fail test: compare every policy with the
-- approved tenant access matrix before inviting any external company.
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'companies', 'company_memberships', 'drivers', 'vehicles',
    'vehicle_assignments', 'documents', 'document_viewers',
    'platform_activity_events', 'platform_trip_records'
  )
order by tablename, policyname;

-- 5) Find active assignments whose driver and vehicle belong to different companies.
-- Run after ownership columns have been backfilled. Adapt active-state semantics
-- to the actual assignment schema; this conservative check includes all assignments.
select count(*) as cross_company_assignment_count
from public.vehicle_assignments a
join public.drivers d on d.id = a.driver_id
join public.vehicles v on v.id = a.vehicle_id
where d.company_id <> v.company_id;

-- 6) Ensure every driver and vehicle has an owner.
select 'drivers_without_company' as check_name, count(*) as row_count
from public.drivers where company_id is null
union all
select 'vehicles_without_company', count(*)
from public.vehicles where company_id is null;
