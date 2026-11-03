-- Simplicity2Take Fleet — atomically apply the complete Bolt fleet snapshot.
-- Service-only RPC: vehicle/driver upserts and assignment decisions commit together.
create or replace function public.s2t_apply_bolt_fleet_sync(
  p_company_id uuid,
  p_vehicles jsonb,
  p_drivers jsonb,
  p_synced_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_expected_company uuid;
  v_item jsonb;
  v_id uuid;
  v_is_new boolean;
  v_bolt_id text;
  v_plate text;
  v_brand text;
  v_model text;
  v_vehicle_year integer;
  v_vin text;
  v_status text;
  v_existing_status text;
  v_company_id uuid;
  v_full_name text;
  v_email text;
  v_phone text;
  v_partner_uuid text;
  v_assigned_vehicle_id uuid;
  v_driver_status_conflict boolean;
  v_vehicle_status_conflicts uuid[] := array[]::uuid[];
  v_assignment_result jsonb;
  v_assignment_action text;
  v_vehicles_received integer;
  v_drivers_received integer;
  v_vehicles_created integer := 0;
  v_drivers_created integer := 0;
  v_vehicle_status_conflicts_count integer := 0;
  v_driver_status_conflicts_count integer := 0;
  v_assignments_created integer := 0;
  v_assignment_conflicts integer := 0;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;

  if p_company_id is null
     or jsonb_typeof(p_vehicles) is distinct from 'array'
     or jsonb_typeof(p_drivers) is distinct from 'array'
     or p_synced_at is null then
    raise exception 'Invalid Bolt sync payload' using errcode = '22023';
  end if;

  select c.id
    into v_expected_company
  from public.companies c
  where c.slug = 'simplicity2take'
    and c.status = 'Ativa'
  limit 1;

  if v_expected_company is null or v_expected_company is distinct from p_company_id then
    raise exception 'Bolt sync is restricted to the trusted S2T company' using errcode = '42501';
  end if;

  v_vehicles_received := jsonb_array_length(p_vehicles);
  v_drivers_received := jsonb_array_length(p_drivers);

  -- Take the same mutex as assignment writers before locking fleet rows.
  lock table public.vehicle_assignments in share row exclusive mode;

  for v_item in select value from jsonb_array_elements(p_vehicles)
  loop
    v_id := nullif(v_item->>'id', '')::uuid;
    v_is_new := coalesce((v_item->>'is_new')::boolean, false);
    v_bolt_id := nullif(btrim(v_item->>'bolt_vehicle_uuid'), '');
    v_plate := coalesce(nullif(btrim(v_item->>'plate'), ''), '');
    v_brand := coalesce(nullif(v_item->>'brand', ''), '');
    v_model := coalesce(nullif(v_item->>'model', ''), '');
    v_vehicle_year := nullif(v_item->>'vehicle_year', '')::integer;
    v_vin := nullif(v_item->>'vin', '');
    v_status := coalesce(nullif(v_item->>'status', ''), 'Inativo');

    if v_id is null then
      raise exception 'Bolt vehicle is missing a local ID' using errcode = '22023';
    end if;

    if v_is_new then
      if exists (select 1 from public.vehicles v where v.id = v_id) then
        raise exception 'Bolt vehicle ID was created by another sync; retry with a fresh snapshot'
          using errcode = '23514';
      end if;
      if v_bolt_id is not null and exists (
        select 1 from public.vehicles v
        where v.bolt_vehicle_uuid = v_bolt_id
          and v.company_id is distinct from p_company_id
      ) then
        raise exception 'Bolt vehicle identity belongs to another company' using errcode = '23514';
      end if;
      if v_plate <> '' and exists (
        select 1 from public.vehicles v
        where lower(btrim(v.plate)) = lower(btrim(v_plate))
          and v.company_id is distinct from p_company_id
      ) then
        raise exception 'Bolt vehicle plate belongs to another company' using errcode = '23514';
      end if;

      insert into public.vehicles (
        id, company_id, plate, brand, model, vehicle_year, vin, status,
        bolt_vehicle_uuid, bolt_last_synced_at
      ) values (
        v_id, p_company_id, v_plate, v_brand, v_model, v_vehicle_year, v_vin, v_status,
        v_bolt_id, p_synced_at
      );
      v_vehicles_created := v_vehicles_created + 1;
    else
      select v.company_id, v.status
        into v_company_id, v_existing_status
      from public.vehicles v
      where v.id = v_id
      for update;

      if not found or v_company_id is distinct from p_company_id then
        raise exception 'Bolt vehicle no longer belongs to the trusted S2T company'
          using errcode = '23514';
      end if;
      if v_bolt_id is not null and exists (
        select 1 from public.vehicles v
        where v.bolt_vehicle_uuid = v_bolt_id
          and v.id <> v_id
          and v.company_id is distinct from p_company_id
      ) then
        raise exception 'Bolt vehicle identity belongs to another company' using errcode = '23514';
      end if;

      if v_status = 'Inativo'
         and v_existing_status is distinct from 'Inativo'
         and exists (
           select 1 from public.vehicle_assignments va
           where va.vehicle_id = v_id
             and (va.active_until is null or va.active_until >= current_date)
         ) then
        v_status := v_existing_status;
        v_vehicle_status_conflicts := array_append(v_vehicle_status_conflicts, v_id);
        v_vehicle_status_conflicts_count := v_vehicle_status_conflicts_count + 1;
      end if;

      update public.vehicles
      set plate = v_plate,
          brand = v_brand,
          model = v_model,
          vehicle_year = v_vehicle_year,
          vin = v_vin,
          status = v_status,
          bolt_vehicle_uuid = v_bolt_id,
          bolt_last_synced_at = p_synced_at
      where id = v_id and company_id = p_company_id;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_drivers)
  loop
    v_id := nullif(v_item->>'id', '')::uuid;
    v_is_new := coalesce((v_item->>'is_new')::boolean, false);
    v_bolt_id := nullif(btrim(v_item->>'bolt_driver_uuid'), '');
    v_partner_uuid := nullif(btrim(v_item->>'bolt_partner_uuid'), '');
    v_full_name := coalesce(nullif(btrim(v_item->>'full_name'), ''), 'Motorista Bolt');
    v_email := nullif(btrim(v_item->>'email'), '');
    v_phone := nullif(btrim(v_item->>'phone'), '');
    v_status := coalesce(nullif(v_item->>'status', ''), 'Inativo');
    v_assigned_vehicle_id := nullif(v_item->>'assigned_vehicle_id', '')::uuid;
    v_driver_status_conflict := false;

    if v_id is null then
      raise exception 'Bolt driver is missing a local ID' using errcode = '22023';
    end if;

    if v_is_new then
      if exists (select 1 from public.drivers d where d.id = v_id) then
        raise exception 'Bolt driver ID was created by another sync; retry with a fresh snapshot'
          using errcode = '23514';
      end if;
      if v_bolt_id is not null and exists (
        select 1 from public.drivers d
        where d.bolt_driver_uuid = v_bolt_id
          and d.company_id is distinct from p_company_id
      ) then
        raise exception 'Bolt driver identity belongs to another company' using errcode = '23514';
      end if;

      insert into public.drivers (
        id, company_id, full_name, email, phone, status,
        bolt_driver_uuid, bolt_partner_uuid, bolt_last_synced_at
      ) values (
        v_id, p_company_id, v_full_name, v_email, v_phone, v_status,
        v_bolt_id, v_partner_uuid, p_synced_at
      );
      v_drivers_created := v_drivers_created + 1;
    else
      select d.company_id, d.status
        into v_company_id, v_existing_status
      from public.drivers d
      where d.id = v_id
      for update;

      if not found or v_company_id is distinct from p_company_id then
        raise exception 'Bolt driver no longer belongs to the trusted S2T company'
          using errcode = '23514';
      end if;
      if v_bolt_id is not null and exists (
        select 1 from public.drivers d
        where d.bolt_driver_uuid = v_bolt_id
          and d.id <> v_id
          and d.company_id is distinct from p_company_id
      ) then
        raise exception 'Bolt driver identity belongs to another company' using errcode = '23514';
      end if;

      if v_status = 'Inativo'
         and v_existing_status is distinct from 'Inativo'
         and exists (
           select 1 from public.vehicle_assignments va
           where va.driver_id = v_id
             and (va.active_until is null or va.active_until >= current_date)
         ) then
        v_status := v_existing_status;
        v_driver_status_conflict := true;
        v_driver_status_conflicts_count := v_driver_status_conflicts_count + 1;
      end if;

      update public.drivers
      set full_name = v_full_name,
          email = v_email,
          phone = v_phone,
          status = v_status,
          bolt_driver_uuid = v_bolt_id,
          bolt_partner_uuid = v_partner_uuid,
          bolt_last_synced_at = p_synced_at
      where id = v_id and company_id = p_company_id;
    end if;

    if v_assigned_vehicle_id is not null then
      if v_driver_status_conflict
         or v_assigned_vehicle_id = any(v_vehicle_status_conflicts) then
        v_assignment_conflicts := v_assignment_conflicts + 1;
      else
        v_assignment_result := public.s2t_bolt_assign_vehicle(v_id, v_assigned_vehicle_id);
        v_assignment_action := coalesce(v_assignment_result->>'action', '');
        if v_assignment_action = 'created' then
          v_assignments_created := v_assignments_created + 1;
        elsif v_assignment_action = 'conflict' then
          v_assignment_conflicts := v_assignment_conflicts + 1;
        elsif v_assignment_action <> 'unchanged' then
          raise exception 'Unexpected Bolt assignment decision' using errcode = 'P0001';
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'drivers', jsonb_build_object(
      'received', v_drivers_received,
      'created', v_drivers_created,
      'updated', v_drivers_received - v_drivers_created
    ),
    'vehicles', jsonb_build_object(
      'received', v_vehicles_received,
      'created', v_vehicles_created,
      'updated', v_vehicles_received - v_vehicles_created
    ),
    'assignments', jsonb_build_object(
      'created', v_assignments_created,
      'conflictsRequiringReview', v_assignment_conflicts
    ),
    'statusConflictsRequiringReview', jsonb_build_object(
      'drivers', v_driver_status_conflicts_count,
      'vehicles', v_vehicle_status_conflicts_count
    )
  );
end;
$function$;

revoke all on function public.s2t_apply_bolt_fleet_sync(uuid, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.s2t_apply_bolt_fleet_sync(uuid, jsonb, jsonb, timestamptz)
  to service_role;

comment on function public.s2t_apply_bolt_fleet_sync(uuid, jsonb, jsonb, timestamptz) is
  'Atomically applies Bolt vehicle and driver snapshots and assignment decisions for the trusted S2T company.';
