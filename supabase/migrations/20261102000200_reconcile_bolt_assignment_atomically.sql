-- Atomic, source-scoped reconciliation for Bolt assignments.
-- Intended for the Edge Function using the service-role client only.
create or replace function public.reconcile_bolt_vehicle_assignment(
  p_driver_id uuid,
  p_vehicle_id uuid,
  p_active_from date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_id uuid;
begin
  if p_driver_id is null or p_vehicle_id is null then
    raise exception 'driver_id and vehicle_id are required';
  end if;

  -- Serialize concurrent reconciliations for this driver.
  perform 1
    from public.drivers
   where id = p_driver_id
   for update;

  if not found then
    raise exception 'Driver % does not exist', p_driver_id;
  end if;

  -- Require an active driver and a vehicle linked to Bolt.
  perform 1
    from public.drivers
   where id = p_driver_id
     and status = 'Ativo';

  if not found then
    raise exception 'Driver % is missing or inactive', p_driver_id;
  end if;

  perform 1
    from public.vehicles
   where id = p_vehicle_id
     and bolt_vehicle_uuid is not null
     and status = 'Ativo';

  if not found then
    raise exception 'Vehicle % is missing, inactive, or not linked to Bolt', p_vehicle_id;
  end if;

  -- Lock all open Bolt rows for this driver before selecting the keeper.
  -- The driver row lock serializes calls to this RPC; row locks protect cleanup.
  perform 1
    from public.vehicle_assignments
   where driver_id = p_driver_id
     and source = 'bolt'
     and active_until is null
   for update;

  -- Keep one matching open Bolt assignment if it already exists.
  select id into v_assignment_id
    from public.vehicle_assignments
   where driver_id = p_driver_id
     and vehicle_id = p_vehicle_id
     and source = 'bolt'
     and active_until is null
   order by created_at, id
   limit 1;

  if v_assignment_id is null then
    -- The table has a unique key on (vehicle_id, driver_id, active_from).
    -- Fail safely if a same-day row from another source occupies that key.
    perform 1
      from public.vehicle_assignments
     where driver_id = p_driver_id
       and vehicle_id = p_vehicle_id
       and active_from = coalesce(p_active_from, current_date)
       and source <> 'bolt';

    if found then
      raise exception 'A non-Bolt assignment already exists for this driver, vehicle, and date';
    end if;

    insert into public.vehicle_assignments
      (driver_id, vehicle_id, active_from, active_until, source)
    values
      (p_driver_id, p_vehicle_id, coalesce(p_active_from, current_date), null, 'bolt')
    returning id into v_assignment_id;
  end if;

  -- Remove only competing open Bolt rows; manual and other sources are untouched.
  delete from public.vehicle_assignments
   where driver_id = p_driver_id
     and source = 'bolt'
     and active_until is null
     and id <> v_assignment_id;

  return v_assignment_id;
end;
$$;

revoke all on function public.reconcile_bolt_vehicle_assignment(uuid, uuid, date) from public;
revoke all on function public.reconcile_bolt_vehicle_assignment(uuid, uuid, date) from anon, authenticated;
grant execute on function public.reconcile_bolt_vehicle_assignment(uuid, uuid, date) to service_role;
