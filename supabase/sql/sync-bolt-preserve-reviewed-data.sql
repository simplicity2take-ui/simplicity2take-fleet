CREATE OR REPLACE FUNCTION public.sync_bolt_fleet(p_drivers jsonb, p_vehicles jsonb, p_assignments jsonb, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  a_driver_bolt_id text;
  a_vehicle_bolt_id text;
  a_plate text;
  a_vehicle_id uuid;
  vehicles_count integer := 0;
  drivers_count integer := 0;
  assignments_count integer := 0;
begin
  -- Vehicles: resolve first by Bolt UUID, then by plate, then insert.
  for item in
    select value from jsonb_array_elements(coalesce(p_vehicles, '[]'::jsonb))
  loop
    v_bolt_id := nullif(trim(item->>'bolt_vehicle_uuid'), '');
    v_plate := nullif(trim(item->>'plate'), '');
    v_brand := nullif(nullif(trim(item->>'brand'), ''), 'Bolt');
    v_model := nullif(nullif(trim(item->>'model'), ''), 'Veículo Bolt');
    v_year := case
      when (item->>'vehicle_year') ~ '^[0-9]{4}$' then (item->>'vehicle_year')::integer
      else null
    end;
    v_vin := upper(nullif(trim(item->>'vin'), ''));
    if v_vin is not null and v_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' then
      v_vin := null;
    end if;
    v_status := coalesce(nullif(trim(item->>'status'), ''), 'Ativo');

    v_id := null;
    if v_bolt_id is not null then
      select id into v_id
      from public.vehicles
      where bolt_vehicle_uuid = v_bolt_id
      limit 1;
    end if;

    if v_id is null and v_plate is not null then
      select id into v_id
      from public.vehicles
      where plate = v_plate
      limit 1;
    end if;

    if v_id is not null then
      update public.vehicles
      set plate = coalesce(v_plate, plate),
          brand = coalesce(nullif(nullif(trim(brand), ''), 'Bolt'), v_brand, 'Por confirmar'),
          model = coalesce(nullif(nullif(trim(model), ''), 'Veículo Bolt'), v_model, 'Por confirmar'),
          vehicle_year = coalesce(vehicle_year, v_year),
          vin = coalesce(nullif(trim(vin), ''), v_vin),
          status = v_status,
          bolt_vehicle_uuid = coalesce(v_bolt_id, bolt_vehicle_uuid),
          bolt_last_synced_at = p_now,
          updated_at = p_now
      where id = v_id;
    elsif v_plate is not null then
      insert into public.vehicles
        (plate, brand, model, vehicle_year, vin, status, bolt_vehicle_uuid, bolt_last_synced_at, updated_at)
      values
        (v_plate, coalesce(v_brand, 'Por confirmar'), coalesce(v_model, 'Por confirmar'), v_year, v_vin, v_status, v_bolt_id, p_now, p_now)
      returning id into v_id;
    end if;

    if v_id is not null then
      vehicles_count := vehicles_count + 1;
    end if;
  end loop;

  -- Drivers: resolve by Bolt UUID, email, then phone, then insert.
  for item in
    select value from jsonb_array_elements(coalesce(p_drivers, '[]'::jsonb))
  loop
    d_bolt_id := nullif(trim(item->>'bolt_driver_uuid'), '');
    d_partner_id := nullif(trim(item->>'bolt_partner_uuid'), '');
    d_name := coalesce(nullif(trim(item->>'full_name'), ''), 'Motorista Bolt');
    d_email := nullif(trim(item->>'email'), '');
    d_phone := nullif(trim(item->>'phone'), '');
    d_status := coalesce(nullif(trim(item->>'status'), ''), 'Ativo');

    d_id := null;
    if d_bolt_id is not null then
      select id into d_id
      from public.drivers
      where bolt_driver_uuid = d_bolt_id
      limit 1;
    end if;

    if d_id is null and d_email is not null then
      select id into d_id
      from public.drivers
      where lower(email) = lower(d_email)
      limit 1;
    end if;

    if d_id is null and d_phone is not null then
      select id into d_id
      from public.drivers
      where phone = d_phone
      limit 1;
    end if;

    if d_id is not null then
      update public.drivers
      set full_name = coalesce(nullif(trim(full_name), ''), d_name),
          email = coalesce(nullif(trim(email), ''), d_email),
          phone = coalesce(nullif(trim(phone), ''), d_phone),
          -- Fleet lifecycle is managed by the administrator / inactivity policy.
          -- A platform account state must not reactivate or deactivate this driver.
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

  -- A selected platform vehicle is an observation, not an administrator assignment.
  -- Keep the assignment history and fixed associations unchanged during sync.

  return jsonb_build_object(
    'vehicles', vehicles_count,
    'drivers', drivers_count,
    'assignmentsUpdated', assignments_count
  );
end;
$function$
;