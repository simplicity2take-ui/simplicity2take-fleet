-- Simplicity2Take Fleet — operational multi-company security inventory.
-- READ-ONLY: safe to run in Supabase SQL Editor; performs catalog SELECTs only.
-- Run in a staging/isolated project before drafting tenant policies for Uber,
-- Bolt, CarTrack, recruitment applications, reports or other operational tables.

-- 1. Every public table/view and its RLS/force-RLS status.
select
  n.nspname as schema_name,
  c.relname as object_name,
  case c.relkind
    when 'r' then 'table'
    when 'p' then 'partitioned table'
    when 'v' then 'view'
    when 'm' then 'materialized view'
    when 'f' then 'foreign table'
    else c.relkind::text
  end as object_type,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm', 'f')
order by object_type, object_name;

-- 2. Existing RLS policies for every public table.
select
  schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 3. Column inventory for operational and potentially sensitive fields.
-- This is intentionally generic: do not assume a particular integration schema.
select
  table_name,
  column_name,
  data_type,
  is_nullable,
  case
    when column_name ilike '%company%' then 'tenant ownership candidate'
    when column_name ilike '%driver%' then 'driver relation / identity candidate'
    when column_name ilike '%vehicle%' then 'vehicle relation candidate'
    when column_name ilike '%profile%' or column_name ilike '%user%' then 'user identity candidate'
    when column_name ilike '%email%' or column_name ilike '%phone%' then 'personal data candidate'
    when column_name ilike '%token%' or column_name ilike '%secret%' or column_name ilike '%credential%' then 'secret candidate — do not expose'
    when column_name ilike '%file%' or column_name ilike '%url%' or column_name ilike '%path%' then 'file/location reference candidate'
    else null
  end as review_hint
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- 4. Foreign-key relationships between public tables (tenant join paths).
select
  tc.table_name as source_table,
  kcu.column_name as source_column,
  ccu.table_name as target_table,
  ccu.column_name as target_column,
  tc.constraint_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.constraint_schema = kcu.constraint_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
 and ccu.constraint_schema = tc.constraint_schema
where tc.constraint_type = 'FOREIGN KEY'
  and tc.constraint_schema = 'public'
order by source_table, tc.constraint_name;

-- 5. SECURITY DEFINER functions: inventory their search_path and grants.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  pg_get_userbyid(p.proowner) as owner,
  coalesce(array_to_string(p.proacl, ', '), '(default ACL)') as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
order by p.proname;

-- 6. Views that may bypass or obscure base-table RLS. Inspect definitions manually.
select schemaname, viewname, definition
from pg_views
where schemaname = 'public'
order by viewname;

-- Interpretation:
-- * Any table containing operational rows without RLS needs explicit review.
-- * A table with RLS can still leak data through a permissive policy, SECURITY
--   DEFINER function, view, Edge Function using service_role, or storage policy.
-- * For integration/report tables, establish a trusted company_id or validated
--   FK path to a company-owned driver/vehicle before writing tenant policies.
-- * Never infer tenant ownership from user-supplied company IDs or platform names.
-- * Do not copy API tokens, refresh tokens, passwords or credential values into
--   browser-visible tables or query results.
