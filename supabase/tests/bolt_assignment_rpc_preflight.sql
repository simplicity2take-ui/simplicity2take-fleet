\set ON_ERROR_STOP on

-- Read-only assertion for Bolt's transactional assignment decision.
do $bolt_assignment_preflight$
declare
  rpc oid;
  definition text;
  expected text[] := array[
    's2t_replace_vehicle_assignments',
    's2t_deactivate_driver',
    's2t_archive_vehicle',
    's2t_bolt_assign_vehicle'
  ];
  name text;
begin
  foreach name in array expected loop
    select p.oid, pg_get_functiondef(p.oid)
      into rpc, definition
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname=name;

    if rpc is null then
      raise exception 'Missing assignment writer RPC: %', name;
    end if;

    if position('lock table public.vehicle_assignments in share row exclusive mode' in lower(definition)) = 0
       or position('lock table public.vehicle_assignments in share row exclusive mode' in lower(definition))
          > position('from public.vehicle_assignments' in lower(definition)) then
      raise exception 'Assignment writer % does not acquire the shared table mutex before reading history', name;
    end if;

    if has_function_privilege('anon', rpc, 'EXECUTE')
       or has_function_privilege('authenticated', rpc, 'EXECUTE') and name='s2t_bolt_assign_vehicle' then
      raise exception 'Unexpected browser execute grant on %', name;
    end if;
  end loop;

  select p.oid into rpc
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='s2t_bolt_assign_vehicle';

  if not has_function_privilege('service_role', rpc, 'EXECUTE') then
    raise exception 'service_role cannot call the Bolt assignment RPC';
  end if;
  if has_function_privilege('authenticated', rpc, 'EXECUTE')
     or has_function_privilege('anon', rpc, 'EXECUTE') then
    raise exception 'Browser roles can call the Bolt assignment RPC';
  end if;
  if (select prosecdef from pg_proc where oid=rpc) then
    raise exception 'Bolt assignment RPC must remain SECURITY INVOKER';
  end if;
  if not (select coalesce(proconfig,array[]::text[]) @> array['search_path=""']::text[] from pg_proc where oid=rpc) then
    raise exception 'Bolt assignment RPC does not pin an empty search_path';
  end if;
  if not has_table_privilege('service_role','public.vehicle_assignments','SELECT')
     or not has_table_privilege('service_role','public.vehicle_assignments','INSERT')
     or not has_table_privilege('service_role','public.vehicle_assignments','UPDATE')
     or not has_table_privilege('service_role','public.drivers','UPDATE')
     or not has_table_privilege('service_role','public.vehicles','UPDATE') then
    raise exception 'service_role lacks table privileges required by the Bolt assignment RPC';
  end if;
end;
$bolt_assignment_preflight$;

select p.proname, p.prosecdef, p.proconfig,
       coalesce(array_to_string(p.proacl, ', '),'(default ACL)') as acl,
       pg_get_functiondef(p.oid) like '%lock table public.vehicle_assignments in share row exclusive mode%' as serializes_assignment_writers
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
    's2t_replace_vehicle_assignments','s2t_deactivate_driver',
    's2t_archive_vehicle','s2t_bolt_assign_vehicle'
  )
order by p.proname;
