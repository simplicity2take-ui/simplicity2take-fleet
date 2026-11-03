-- Simplicity2Take Fleet — multi-company RLS preflight.
-- Run only AFTER all company migrations have been applied to a disposable database.
-- Read-only assertions: this script does not insert, update, delete or alter data.

do $preflight$
declare
  missing text;
  invalid_policy text;
begin
  select string_agg(required, ', ')
    into missing
  from (values
    ('drivers.company_id'),
    ('vehicles.company_id'),
    ('documents.company_id'),
    ('platform_activity_events.company_id'),
    ('platform_trip_records.company_id'),
    ('vehicle_assignments.active_from'),
    ('vehicle_assignments.active_until'),
    ('document_viewers.can_view')
  ) as expected(required)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and (c.table_name || '.' || c.column_name) = expected.required
  );

  if missing is not null then
    raise exception 'Company RLS preflight failed; missing columns: %', missing;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'vehicle_assignments'
      and column_name = 'active'
  ) then
    raise exception 'Unexpected vehicle_assignments.active column; use active_from/active_until.';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'company_memberships'
      and c.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on public.company_memberships.';
  end if;

  select string_agg(expected.table_name || ':' || expected.policy_name, ', ')
    into missing
  from (values
    ('drivers', 's2t drivers company read'),
    ('vehicles', 's2t vehicles company read'),
    ('vehicle_assignments', 's2t assignments company read'),
    ('documents', 's2t documents company scope'),
    ('document_viewers', 's2t document viewers company scope'),
    ('platform_activity_events', 's2t_platform_activity_company_scope'),
    ('platform_trip_records', 's2t_platform_trips_company_scope'),
    ('company_memberships', 's2t memberships self or global admin'),
    ('company_memberships', 's2t memberships global admin writes')
  ) as expected(table_name, policy_name)
  where not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = expected.table_name
      and p.policyname = expected.policy_name
  );

  if missing is not null then
    raise exception 'Company RLS preflight failed; missing policies: %', missing;
  end if;

  select p.policyname into invalid_policy
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'documents'
    and p.policyname = 's2t documents company scope'
    and p.qual ~ 'va\\.active([^_a-z]|$)'
  limit 1;

  if invalid_policy is not null then
    raise exception 'Document policy % refers to the obsolete active column.', invalid_policy;
  end if;

  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'documents'
      and p.policyname = 's2t documents company scope'
      and p.qual ilike '%document_viewers%'
  ) then
    raise exception 'Document SELECT policy directly queries document_viewers and risks recursive RLS.';
  end if;

  if not exists (
    select 1 from pg_proc f
    join pg_namespace n on n.oid = f.pronamespace
    where n.nspname = 'public'
      and f.proname = 's2t_driver_can_view_document'
      and f.prosecdef
      and coalesce(array_to_string(f.proconfig, ','), '') like '%search_path=%'
  ) then
    raise exception 'Missing hardened SECURITY DEFINER document-viewer helper.';
  end if;

  raise notice 'Company RLS preflight passed.';
end;
$preflight$;
