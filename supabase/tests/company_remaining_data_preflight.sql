-- Simplicity2Take Fleet — remaining tenant-data inventory.
-- READ-ONLY. Run after the company foundation exists in an isolated Supabase DB.
-- This intentionally discovers actual names/columns instead of assuming them.
-- It does not alter schema, policies, data, or function privileges.

-- 1. Candidate operational tables and RLS state.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  pg_total_relation_size(c.oid) as total_bytes
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and n.nspname = 'public'
  and (
    c.relname ilike '%uber%'
    or c.relname ilike '%bolt%'
    or c.relname ilike '%cartrack%'
    or c.relname ilike '%application%'
    or c.relname ilike '%candidate%'
    or c.relname ilike '%audit%'
    or c.relname ilike '%setting%'
    or c.relname ilike '%profile%'
    or c.relname ilike '%document%'
    or c.relname ilike '%platform%'
  )
order by c.relname;

-- 2. Columns on the discovered tables. Use this to identify trusted driver,
-- vehicle, company, provider-account and import-batch relationships.
select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and (
    table_name ilike '%uber%'
    or table_name ilike '%bolt%'
    or table_name ilike '%cartrack%'
    or table_name ilike '%application%'
    or table_name ilike '%candidate%'
    or table_name ilike '%audit%'
    or table_name ilike '%setting%'
    or table_name ilike '%profile%'
    or table_name ilike '%document%'
    or table_name ilike '%platform%'
  )
order by table_name, ordinal_position;

-- 3. Existing policies on all discovered candidate tables.
select
  p.schemaname,
  p.tablename,
  p.policyname,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual,
  p.with_check
from pg_policies p
where p.schemaname = 'public'
  and (
    p.tablename ilike '%uber%'
    or p.tablename ilike '%bolt%'
    or p.tablename ilike '%cartrack%'
    or p.tablename ilike '%application%'
    or p.tablename ilike '%candidate%'
    or p.tablename ilike '%audit%'
    or p.tablename ilike '%setting%'
    or p.tablename ilike '%profile%'
    or p.tablename ilike '%document%'
    or p.tablename ilike '%platform%'
  )
order by p.tablename, p.policyname;

-- 4. Foreign-key relationships for candidate operational tables.
select
  child.relname as child_table,
  child_col.attname as child_column,
  parent.relname as parent_table,
  parent_col.attname as parent_column,
  con.conname as constraint_name
from pg_constraint con
join pg_class child on child.oid = con.conrelid
join pg_namespace child_ns on child_ns.oid = child.relnamespace
join pg_class parent on parent.oid = con.confrelid
join unnest(con.conkey) with ordinality child_key(attnum, ord) on true
join unnest(con.confkey) with ordinality parent_key(attnum, ord)
  on parent_key.ord = child_key.ord
join pg_attribute child_col
  on child_col.attrelid = child.oid and child_col.attnum = child_key.attnum
join pg_attribute parent_col
  on parent_col.attrelid = parent.oid and parent_col.attnum = parent_key.attnum
where con.contype = 'f'
  and child_ns.nspname = 'public'
  and (
    child.relname ilike '%uber%'
    or child.relname ilike '%bolt%'
    or child.relname ilike '%cartrack%'
    or child.relname ilike '%application%'
    or child.relname ilike '%candidate%'
    or child.relname ilike '%audit%'
    or child.relname ilike '%setting%'
    or child.relname ilike '%profile%'
    or child.relname ilike '%document%'
    or child.relname ilike '%platform%'
  )
order by child.relname, child_col.attname;

-- 5. SECURITY DEFINER functions that may bypass caller RLS.
-- Review definitions manually; this query does not determine whether a function
-- is safe. In particular, inspect service-role imports and tenant resolution.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.proconfig as function_settings,
  coalesce(array_to_string(p.proacl, ', '), '(default ACL)') as function_acl,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and (
    p.proname ilike '%uber%'
    or p.proname ilike '%bolt%'
    or p.proname ilike '%cartrack%'
    or p.proname ilike '%application%'
    or p.proname ilike '%document%'
    or p.proname ilike '%sync%'
    or p.proname ilike '%import%'
  )
order by p.proname;

-- 6. Check whether profile records have a company relation or whether the
-- application must use company_memberships. Do not infer tenant ownership
-- from email domains or browser-supplied company IDs.
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
order by ordinal_position;
