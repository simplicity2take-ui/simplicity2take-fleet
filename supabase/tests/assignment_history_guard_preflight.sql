-- Disposable-database preflight for the PR #37 security patch.
-- Run only after applying the reviewed migrations and RPC draft in a local/test DB.
-- This file is read-only and deliberately contains no fixture writes.

do $test$
declare
  v_trigger_definition text;
  v_function_definition text;
  v_delete_policy_count integer;
begin
  select pg_get_triggerdef(t.oid)
    into v_trigger_definition
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'drivers'
    and t.tgname = 's2t_drivers_company_ownership_guard'
    and not t.tgisinternal;

  if v_trigger_definition is null
     or position('profile_id' in v_trigger_definition) = 0 then
    raise exception 'FAIL: drivers guard trigger does not cover profile_id';
  end if;

  select pg_get_functiondef('public.s2t_guard_company_ownership_change()'::regprocedure)
    into v_function_definition;

  if position('new.profile_id' in v_function_definition) = 0
     or position('s2t_is_admin' in v_function_definition) = 0 then
    raise exception 'FAIL: trigger function does not enforce global-admin-only profile_id changes';
  end if;

  select count(*)
    into v_delete_policy_count
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'vehicle_assignments'
    and p.cmd in ('DELETE', 'ALL')
    and ('authenticated' = any(p.roles) or 'public' = any(p.roles));

  if v_delete_policy_count <> 0 then
    raise exception 'FAIL: vehicle_assignments still has a DELETE/ALL policy for authenticated/public';
  end if;

  if has_table_privilege('authenticated', 'public.vehicle_assignments', 'DELETE') then
    raise exception 'FAIL: authenticated still has DELETE table privilege on vehicle_assignments';
  end if;

  if has_table_privilege('anon', 'public.vehicle_assignments', 'DELETE') then
    raise exception 'FAIL: anon still has DELETE table privilege on vehicle_assignments';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 's2t_replace_vehicle_assignments'
      and p.prosecdef = false
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    raise exception 'FAIL: assignment replacement RPC missing or has unsafe execution grants';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 's2t_deactivate_driver'
      and p.prosecdef = false
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    raise exception 'FAIL: driver deactivation RPC missing or has unsafe execution grants';
  end if;

  raise notice 'PASS: profile guard, assignment delete prohibition and invoker RPC grants are present';
end;
$test$;
