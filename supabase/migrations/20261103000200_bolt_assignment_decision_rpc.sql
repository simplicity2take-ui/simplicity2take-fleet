-- Bolt assignment decision RPC.
-- Serializes Bolt writes with Fleet assignment, deactivation and archive RPCs.
-- Requires the company foundation and fleet_assignment_history_security migrations.

-- The trusted server role needs only the reads, row locks and assignment write used here.
grant select on public.companies to service_role;
grant select, update on public.drivers, public.vehicles to service_role;
grant select, insert, update on public.vehicle_assignments to service_role;

create or replace function public.s2t_bolt_assign_vehicle(
  p_driver_id uuid,
  p_vehicle_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_driver_company_id uuid;
  v_vehicle_company_id uuid;
  v_driver_status text;
  v_vehicle_status text;
  v_driver_active_count bigint := 0;
  v_vehicle_active_count bigint := 0;
  v_has_exact_pair boolean := false;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;

  if p_driver_id is null or p_vehicle_id is null then
    raise exception 'Driver and vehicle IDs are required' using errcode = '22023';
  end if;

  select c.id into v_company_id
  from public.companies c
  where c.slug = 'simplicity2take'
    and c.status = 'Ativa'
  limit 1;

  if v_company_id is null then
    raise exception 'Simplicity2Take company is not configured' using errcode = 'P0002';
  end if;

  -- This must be acquired before row locks or assignment reads. It conflicts
  -- with ordinary INSERT/UPDATE/DELETE writers and serializes the decision.
  lock table public.vehicle_assignments in share row exclusive mode;

  select d.company_id, d.status
    into v_driver_company_id, v_driver_status
  from public.drivers d
  where d.id = p_driver_id
  for update;

  if v_driver_company_id is distinct from v_company_id then
    raise exception 'Bolt driver does not belong to the trusted S2T company'
      using errcode = 'P0002';
  end if;

  select v.company_id, v.status
    into v_vehicle_company_id, v_vehicle_status
  from public.vehicles v
  where v.id = p_vehicle_id
  for update;

  if v_vehicle_company_id is distinct from v_company_id then
    raise exception 'Bolt vehicle does not belong to the trusted S2T company'
      using errcode = 'P0002';
  end if;

  if coalesce(v_driver_status, '') <> 'Ativo' then
    return jsonb_build_object('action', 'conflict', 'reason', 'inactive_driver');
  end if;

  if coalesce(v_vehicle_status, '') <> 'Ativo' then
    return jsonb_build_object('action', 'conflict', 'reason', 'inactive_vehicle');
  end if;

  select
    count(*) filter (where va.driver_id = p_driver_id),
    count(*) filter (where va.vehicle_id = p_vehicle_id),
    coalesce(bool_or(va.driver_id = p_driver_id and va.vehicle_id = p_vehicle_id), false)
    into v_driver_active_count, v_vehicle_active_count, v_has_exact_pair
  from public.vehicle_assignments va
  where (va.driver_id = p_driver_id or va.vehicle_id = p_vehicle_id)
    and va.active_from <= current_date
    and (va.active_until is null or va.active_until >= current_date);

  if v_driver_active_count > 1 or v_vehicle_active_count > 1 then
    return jsonb_build_object('action', 'conflict', 'reason', 'multiple_active_assignments');
  end if;

  if v_has_exact_pair then
    return jsonb_build_object('action', 'unchanged');
  end if;

  if v_driver_active_count > 0 or v_vehicle_active_count > 0 then
    return jsonb_build_object('action', 'conflict', 'reason', 'active_assignment_exists');
  end if;

  insert into public.vehicle_assignments (vehicle_id, driver_id, active_from, active_until)
  values (p_vehicle_id, p_driver_id, current_date, null);

  return jsonb_build_object('action', 'created');
end;
$function$;

revoke all on function public.s2t_bolt_assign_vehicle(uuid, uuid) from public, anon, authenticated;
grant execute on function public.s2t_bolt_assign_vehicle(uuid, uuid) to service_role;

comment on function public.s2t_bolt_assign_vehicle(uuid, uuid) is
  'Service-only Bolt assignment decision. Resolves S2T server-side, preserves assignment history, and serializes writers.';
