-- Fix Bolt sync assignment isolation.
-- Bolt may replace only Bolt-owned assignments. Manual and Uber assignments are preserved.
-- Prepare and validate in staging before applying to production.

create or replace function public.sync_bolt_fleet(
  p_drivers jsonb,
  p_vehicles jsonb,
  p_assignments jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  item jsonb;
  v_id uuid;
  d_id uuid;
  v_bolt_id text;
  v_plate text;
  v_brand text;
  v_model text;
  v_year integer;
  v_vin text;
  v_status text;
  d_bolt_id text;
  d_partner_id text;
  d_name text;
  d_email text;
  d_phone text;
  d_status text;
  a_vehicle_bolt_id text;
  a_plate text;
  a_vehicle_id uuid;
  vehicles_count integer := 0;
  drivers_count integer := 0;
  assignments_count integer := 0;
begin
  -- Vehicles: resolve first by Bolt UUID, then by plate, then insert.
  for item in select value from jsonb_array_elements(coalesce(p_vehicles, '[]'::jsonb))
  loop
    v_bolt_id := nullif(trim(item->>'bolt_vehicle_uuid'), '');
    v_plate := nullif(trim(item->>'plate'), '');
    v_brand := coalesce(nullif(trim(item->>'brand'), ''), 'Bolt');
    v_model := coalesce(nullif(trim(item->>'model'), ''), 'Veículo Bolt');
    v_year := case when (item->>'vehicle_year') ~ '^[0-9]{4}$' then (item->>'vehicle_year')::integer else null end;
    v_vin := nullif(trim(item->>'vin'), '');
    v_status := coalesce(nullif(trim(item->>'status'), ''), 'Ativo');

    v_id := null;
    if v_bolt_id is not null then
      select id into v_id from public.vehicles where bolt_vehicle_uuid = v_bolt_id limit 1;
    end if;
    if v_id is null and v_plate is not null then
      select id into v_id from public.vehicles where plate = v_plate limit 1;
    end if;

    if v_id is not null then
      update public.vehicles
      set plate = coalesce(v_plate, plate),
          brand = coalesce(v_brand, brand),
          model = coalesce(v_model, model),
          vehicle_year = coalesce(v_year, vehicle_year),
          vin = coalesce(v_vin, vin),
          status = v_status,
          bolt_vehicle_uuid = coalesce(v_bolt_id, bolt_vehicle_uuid),
          bolt_last_synced_at = p_now,
          updated_at = p_now
      where id = v_id;
    elsif v_plate is not null then
      insert into public.vehicles
        (plate, brand, model, vehicle_year, vin, status, bolt_vehicle_uuid, bolt_last_synced_at, updated_at)
      values
        (v_plate, v_brand, v_model, v_year, v_vin, v_status, v_bolt_id, p_now, p_now)
      returning id into v_id;
    end if;

    if v_id is not null then vehicles_count := vehicles_count + 1; end if;
  end loop;

  -- Drivers: resolve by Bolt UUID, email, then phone, then insert.
  for item in select value from jsonb_array_elements(coalesce(p_drivers, '[]'::jsonb))
  loop
    d_bolt_id := nullif(trim(item->>'bolt_driver_uuid'), '');
    d_partner_id := nullif(trim(item->>'bolt_partner_uuid'), '');
    d_name := coalesce(nullif(trim(item->>'full_name'), ''), 'Motorista Bolt');
    d_email := nullif(trim(item->>'email'), '');
    d_phone := nullif(trim(item->>'phone'), '');
    d_status := coalesce(nullif(trim(item->>'status'), ''), 'Ativo');

    d_id := null;
    if d_bolt_id is not null then
      select id into d_id from public.drivers where bolt_driver_uuid = d_bolt_id limit 1;
    end if;
    if d_id is null and d_email is not null then
      select id into d_id from public.drivers where lower(email) = lower(d_email) limit 1;
    end if;
    if d_id is null and d_phone is not null then
      select id into d_id from public.drivers where phone = d_phone limit 1;
    end if;

    if d_id is not null then
      update public.drivers
      set full_name = d_name,
          email = coalesce(d_email, email),
          phone = coalesce(d_phone, phone),
          status = d_status,
          bolt_driver_uuid = coalesce(d_bolt_id, bolt_driver_uuid),
          bolt_partner_uuid = coalesce(d_partner_id, bolt_partner_uuid),
          bolt_last_synced_at = p_now,
          updated_at = p_now
      where id = d_id;
    else
      insert into public.drivers
        (full_name, email, phone, status, bolt_driver_uuid, bolt_partner_uuid, bolt_last_synced_at, updated_at)
      values
        (d_name, d_email, d_phone, d_status, d_bolt_id, d_partner_id, p_now, p_now)
      returning id into d_id;
    end if;

    drivers_count := drivers_count + 1;
  end loop;

  -- Only active drivers with a resolvable vehicle can replace their Bolt assignment.
  -- Missing/inactive drivers and unresolved vehicles do not destroy existing assignments.
  for item in select value from jsonb_array_elements(coalesce(p_drivers, '[]'::jsonb))
  loop
    d_bolt_id := nullif(trim(item->>'bolt_driver_uuid'), '');
    if d_bolt_id is null then continue; end if;

    select id, status into d_id, d_status
    from public.drivers where bolt_driver_uuid = d_bolt_id limit 1;

    if d_id is null or lower(coalesce(d_status, '')) not in ('ativo', 'active') then
      continue;
    end if;

    a_vehicle_bolt_id := nullif(trim(item->>'active_vehicle_bolt_uuid'), '');
    a_plate := nullif(trim(item->>'active_vehicle_plate'), '');
    a_vehicle_id := null;

    if a_vehicle_bolt_id is not null then
      select id into a_vehicle_id from public.vehicles where bolt_vehicle_uuid = a_vehicle_bolt_id limit 1;
    end if;
    if a_vehicle_id is null and a_plate is not null then
      select id into a_vehicle_id from public.vehicles where plate = a_plate limit 1;
    end if;

    -- Preserve current Bolt association if incoming vehicle cannot be resolved.
    if a_vehicle_id is null then continue; end if;

    delete from public.vehicle_assignments
    where driver_id = d_id and source = 'bolt';

    insert into public.vehicle_assignments
      (vehicle_id, driver_id, active_from, active_until, source)
    values
      (a_vehicle_id, d_id, (p_now at time zone 'UTC')::date, null, 'bolt');

    assignments_count := assignments_count + 1;
  end loop;

  return jsonb_build_object(
    'vehicles', vehicles_count,
    'drivers', drivers_count,
    'assignmentsUpdated', assignments_count
  );
end;
$function$;
