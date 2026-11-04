-- Simplicity2Take Fleet — Bolt import safety preflight (READ ONLY).
-- Run against an authorized staging database before planning multi-company imports.
-- This script makes no data or schema changes and exposes no driver details.
-- It does not prove tenant isolation: review RLS, RPCs and service-role callers separately.

-- 1. Confirm the operational tables exist and whether RLS is enabled.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r','p')
  and c.relname in ('drivers','vehicles','platform_activity_events','platform_trip_records')
order by c.relname;

-- 2. Inventory company/tenant keys without assuming the target schema.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('drivers','vehicles','platform_activity_events','platform_trip_records')
  and (column_name ilike '%company%' or column_name ilike '%tenant%'
       or column_name ilike '%bolt%' or column_name in ('driver_id','vehicle_id'))
order by table_name, column_name;

-- 3. Inspect unique constraints/index definitions for provider identifiers.
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('drivers','vehicles','platform_activity_events','platform_trip_records')
  and (indexdef ilike '%bolt%' or indexdef ilike '%source_trip_id%'
       or indexdef ilike '%event_key%')
order by tablename, indexname;

-- 4. Inspect active SELECT policies. Other permissive policies may widen access.
select tablename, policyname, roles, permissive, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('drivers','vehicles','platform_activity_events','platform_trip_records')
order by tablename, policyname;

-- 5. Review privileged import functions and their grants before enabling new tenants.
select p.oid::regprocedure as function_signature, p.prosecdef as security_definer,
       p.proconfig as settings, p.proacl as acl, pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('sync_bolt_activity','reconcile_bolt_vehicle_assignment')
order by p.proname;

-- Before multi-company enablement: require explicit tenant scoping for provider
-- identity lookups, event/trip uniqueness, writes and SELECT policies. Do not
-- apply schema changes based only on this report.

-- 6. Discover potential company and membership tables before designing tenant keys.
select c.table_name, c.column_name, c.data_type
from information_schema.columns c
where c.table_schema = 'public'
  and (c.table_name ilike '%compan%'
       or c.table_name ilike '%tenant%'
       or c.table_name ilike '%member%'
       or c.column_name ilike '%company_id%'
       or c.column_name ilike '%tenant_id%')
order by c.table_name, c.ordinal_position;

-- 7. Inspect existing foreign-key ownership chains without reading personal data.
select con.conrelid::regclass as source_table,
       con.conname as constraint_name,
       con.confrelid::regclass as referenced_table,
       pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_namespace n on n.oid = con.connamespace
where n.nspname = 'public' and con.contype = 'f'
  and (con.conrelid::regclass::text ~* '(drivers|vehicles|assignments|platform_|compan|tenant|member)'
       or con.confrelid::regclass::text ~* '(compan|tenant|member)')
order by source_table::text, constraint_name;

-- 8. Inventory company/tenant policies, including permissive policies.
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and (tablename ilike '%compan%' or tablename ilike '%tenant%'
       or tablename ilike '%member%')
order by tablename, policyname;
