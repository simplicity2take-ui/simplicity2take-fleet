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

  if v_definition !~* 'active_until\s+is\s+null' then
    raise exception 'Regression: RPC does not restrict reconciliation to open assignments';
  end if;

  -- Unique key includes source-independent (driver, vehicle, active_from).
  -- RPC must detect the collision and preserve the existing manual/history row.
  if v_definition !~* 'active_from\s*=\s*coalesce\(p_active_from,\s*current_date\)' then
    raise exception 'Regression: RPC does not guard same-day assignment conflicts';
  end if;
  if v_definition !~* 'manual or historical row preserved' then
    raise exception 'Regression: RPC does not explicitly preserve conflicting manual/history rows';
  end if;

  -- pg_get_functiondef returns the function DDL/body, not the GRANT/REVOKE
  -- statements that follow it in the migration. Check effective privileges.
  if has_function_privilege('anon', 'public.reconcile_bolt_vehicle_assignment(uuid,uuid,date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.reconcile_bolt_vehicle_assignment(uuid,uuid,date)', 'EXECUTE') then
    raise exception 'Regression: RPC is executable by an unprivileged API role';
  end if;
  if not has_function_privilege('service_role', 'public.reconcile_bolt_vehicle_assignment(uuid,uuid,date)', 'EXECUTE') then
    raise exception 'Regression: service_role cannot execute the assignment RPC';
  end if;
end $$;
