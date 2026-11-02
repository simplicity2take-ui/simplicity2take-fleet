-- Static regression guard for the atomic Bolt assignment RPC.
-- Run against a database where the migration has been applied.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.reconcile_bolt_vehicle_assignment(uuid,uuid,date)'::regprocedure)
    into v_definition;

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
