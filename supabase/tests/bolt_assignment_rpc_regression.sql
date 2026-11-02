-- Static regression guard for the atomic Bolt assignment RPC.
-- Read-only catalog checks; does not mutate assignment data.
do $$
declare
  v_definition text;
  v_security_definer boolean;
begin
  select pg_get_functiondef(
    'public.reconcile_bolt_vehicle_assignment(uuid,uuid,date)'::regprocedure
  ), p.prosecdef
    into v_definition, v_security_definer
    from pg_proc p
   where p.oid = 'public.reconcile_bolt_vehicle_assignment(uuid,uuid,date)'::regprocedure;

  if v_definition is null then
    raise exception 'reconcile_bolt_vehicle_assignment function was not found';
  end if;

  if not v_security_definer then
    raise exception 'Regression: assignment RPC must be SECURITY DEFINER';
  end if;

  if v_definition !~* 'from\s+public\.drivers[\s\S]*for\s+update' then
    raise exception 'Regression: RPC does not lock the driver row';
  end if;

  if v_definition !~* 'source\s*=\s*''bolt''' then
    raise exception 'Regression: RPC is not explicitly scoped to source=bolt';
  end if;

  if v_definition !~* 'bolt_vehicle_uuid\s+is\s+not\s+null' then
    raise exception 'Regression: RPC does not validate Bolt-linked vehicle';
  end if;

  if v_definition !~* 'status\s*=\s*''Ativo''' then
    raise exception 'Regression: RPC does not validate active status';
  end if;

  if v_definition ~* 'delete\s+from\s+public\.vehicle_assignments\s+where\s+driver_id\s*=\s*p_driver_id\s*;' then
    raise exception 'Regression: RPC contains an unscoped assignment delete';
  end if;
end $$;
