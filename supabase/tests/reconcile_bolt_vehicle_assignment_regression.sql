-- Static regression guard for the atomic Bolt assignment RPC.
-- Run against a database where the migration has been applied.
do $$
declare
  v_definition text;
  v_is_security_definer boolean;
  v_config text[];
begin
  select pg_get_functiondef(p.oid), p.prosecdef, p.proconfig
    into v_definition, v_is_security_definer, v_config
    from pg_proc p
   where p.oid = 'public.reconcile_bolt_vehicle_assignment(uuid,uuid,date)'::regprocedure;

  if not v_is_security_definer then
    raise exception 'Bolt assignment RPC must run as SECURITY DEFINER';
  end if;
  if not coalesce(array_to_string(v_config, ','), '') like '%search_path=public%' then
    raise exception 'Bolt assignment RPC must pin search_path to public';
  end if;
  if position('FOR UPDATE' in upper(v_definition)) = 0 then
    raise exception 'Bolt assignment RPC must lock the driver row';
  end if;
  if position('bolt_vehicle_uuid' in v_definition) = 0 then
    raise exception 'Bolt assignment RPC must validate Bolt vehicle identity';
  end if;
  if position('source' in v_definition) = 0 then
    raise exception 'Bolt assignment RPC must preserve assignment source';
  end if;
  if position('active_until' in v_definition) = 0 then
    raise exception 'Bolt assignment RPC must reconcile open assignments';
  end if;
end;
$$;
