-- Simplicity2Take Fleet — discovery preflight for remaining operational tenant data.
-- READ-ONLY: catalog inspection only. Safe to run before the tenant migrations.
-- Run in a disposable/staging Supabase project and review results before drafting
-- tenant policies for any of these tables. No rows or policies are changed.

-- 1) Find likely operational/import tables and report whether RLS is enabled/forced.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  pg_total_relation_size(c.oid) as total_bytes
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and n.nspname not in ('pg_catalog', 'information_schema')
  and (
    c.relname ilike '%uber%'
    or c.relname ilike '%bolt%'
    or c.relname ilike '%cartrack%'
    or c.relname ilike '%application%'
    or c.relname ilike '%recruit%'
    or c.relname ilike '%trip%'
    or c.relname ilike '%activity%'
    or c.relname ilike '%payment%'
    or c.relname ilike '%vehicle%'
    or c.relname ilike '%driver%'
  )
order by n.nspname, c.relname;

-- 2) List columns for the matching public tables. This establishes actual
-- ownership keys and prevents guessing column names in future migrations.
select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    table_name ilike '%uber%'
    or table_name ilike '%bolt%'
    or table_name ilike '%cartrack%'
    or table_name ilike '%application%'
    or table_name ilike '%recruit%'
    or table_name ilike '%trip%'
    or table_name ilike '%activity%'
    or table_name ilike '%payment%'
    or table_name ilike '%vehicle%'
    or table_name ilike '%driver%'
  )
order by table_name, ordinal_position;

-- 3) Foreign keys from those tables to drivers, vehicles, companies or profiles.
-- A table with no direct company_id may still be safely scoped through these FKs.
select
  src.relname as source_table,
  con.conname as constraint_name,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class src on src.oid = con.conrelid
join pg_namespace n on n.oid = src.relnamespace
where con.contype = 'f'
  and n.nspname = 'public'
  and (
    src.relname ilike '%uber%'
    or src.relname ilike '%bolt%'
    or src.relname ilike '%cartrack%'
    or src.relname ilike '%application%'
    or src.relname ilike '%recruit%'
    or src.relname ilike '%trip%'
    or src.relname ilike '%activity%'
    or src.relname ilike '%payment%'
  )
  and (
    pg_get_constraintdef(con.oid) ilike '%drivers%'
    or pg_get_constraintdef(con.oid) ilike '%vehicles%'
    or pg_get_constraintdef(con.oid) ilike '%companies%'
    or pg_get_constraintdef(con.oid) ilike '%profiles%'
  )
order by src.relname, con.conname;

-- 4) Current policies for the operational tables above. Remember PostgreSQL
-- permissive policies combine with OR: adding a tenant policy does not neutralise
-- an older broad policy. Every returned policy must be reviewed.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and (
    tablename ilike '%uber%'
    or tablename ilike '%bolt%'
    or tablename ilike '%cartrack%'
    or tablename ilike '%application%'
    or tablename ilike '%recruit%'
    or tablename ilike '%trip%'
    or tablename ilike '%activity%'
    or tablename ilike '%payment%'
  )
order by tablename, policyname;

-- 5) SECURITY DEFINER functions that reference operational/import tables.
-- Inspect function bodies manually for service-role bypass and missing tenant filters.
select
  p.oid::regprocedure as function_signature,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and (
    pg_get_functiondef(p.oid) ilike '%uber%'
    or pg_get_functiondef(p.oid) ilike '%bolt%'
    or pg_get_functiondef(p.oid) ilike '%cartrack%'
    or pg_get_functiondef(p.oid) ilike '%platform_trip_records%'
    or pg_get_functiondef(p.oid) ilike '%platform_activity_events%'
  )
order by p.proname;

-- 6) Existing company-scoped core tables and policy inventory, for comparison.
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
