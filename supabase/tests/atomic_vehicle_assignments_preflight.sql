-- Simplicity2Take Fleet — atomic vehicle assignment RPC preflight.
-- Read-only checks to run only AFTER the RPC migration has been installed
-- in a disposable/test database. This does not execute the function or mutate data.

do $preflight$
declare
  v_function oid;
  v_definition text;
  v_config text[];
begin
  select p.oid, pg_get_functiondef(p.oid), p.proconfig
    into v_function, v_definition, v_config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 's2t_replace_vehicle_assignments'
    and pg_get_function_identity_arguments(p.oid) = 'p_vehicle_id uuid, p_driver_ids uuid[]';

  if v_function is null then
    raise exception 'Atomic assignments preflight failed: RPC function is missing.';
  end if;

  if (select p.prosecdef from pg_proc p where p.oid = v_function) then
    raise exception 'RPC must remain SECURITY INVOKER.';
  end if;

  if not exists (
    select 1 from unnest(coalesce(v_config, array[]::text[])) setting
    where setting like 'search_path=%'
      and regexp_replace(setting, '^search_path=', '') in ('', '""')
  ) then
    raise exception 'RPC must pin an empty search_path.';
  end if;

  if has_function_privilege('anon', v_function, 'EXECUTE')
     or has_function_privilege('public', v_function, 'EXECUTE') then
    raise exception 'RPC must not be executable by anon or PUBLIC.';
  end if;

  if not has_function_privilege('authenticated', v_function, 'EXECUTE') then
    raise exception 'RPC must be executable by authenticated.';
  end if;

  if v_definition not ilike '%auth.uid() is null%'
     or v_definition not ilike '%s2t_is_admin()%'
     or v_definition not ilike '%s2t_is_company_admin(v_company_id)%' then
    raise exception 'RPC is missing its session or company-admin authorization checks.';
  end if;

  if v_definition not ilike '%for update%'
     or v_definition not ilike '%order by d.id%' then
    raise exception 'RPC is missing deterministic row locks for vehicle and selected drivers.';
  end if;

  if v_definition not ilike '%active_from = current_date%'
     or v_definition not ilike '%current_date - 1%' then
    raise exception 'RPC is missing the same-day interval guard or historical close behavior.';
  end if;

  if v_definition ilike '%delete from public.vehicle_assignments%' then
    raise exception 'RPC must preserve assignment history; DELETE is not allowed.';
  end if;

  raise notice 'Atomic vehicle assignment RPC preflight passed.';
end;
$preflight$;
