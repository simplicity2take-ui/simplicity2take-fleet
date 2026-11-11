SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $fleet_lifecycle_deploy$
DECLARE before_rows jsonb; after_rows jsonb;
BEGIN
  LOCK TABLE public.drivers IN SHARE MODE;
  SELECT jsonb_agg(to_jsonb(d) ORDER BY id) INTO before_rows FROM public.drivers d;
  IF pg_get_functiondef('public.sync_bolt_fleet(jsonb,jsonb,jsonb,timestamp with time zone)'::regprocedure) IS DISTINCT FROM $original_definition$CREATE OR REPLACE FUNCTION public.sync_bolt_fleet(p_drivers jsonb, p_vehicles jsonb, p_assignments jsonb, p_now timestamp with time zone DEFAULT now())
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

    d_id := public.fleet_resolve_driver_identity('bolt',d_bolt_id,d_name,d_email,d_phone);

    if d_id is not null then
      update public.drivers
      set full_name = coalesce(nullif(trim(full_name), ''), d_name),
          email = coalesce(nullif(trim(email), ''), d_email),
          phone = coalesce(nullif(trim(phone), ''), d_phone),
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

  -- A selected platform vehicle is an observation, not an administrator assignment.
  -- Keep the assignment history and fixed associations unchanged during sync.

  return jsonb_build_object(
    'vehicles', vehicles_count,
    'drivers', drivers_count,
    'assignmentsUpdated', assignments_count
  );
end;
$function$
$original_definition$ THEN
    RAISE EXCEPTION 'Definition changed since review: sync_bolt_fleet';
  END IF;
  EXECUTE $replacement_definition$CREATE OR REPLACE FUNCTION public.sync_bolt_fleet(p_drivers jsonb, p_vehicles jsonb, p_assignments jsonb, p_now timestamp with time zone DEFAULT now())
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

    d_id := public.fleet_resolve_driver_identity('bolt',d_bolt_id,d_name,d_email,d_phone);

    if d_id is not null then
      update public.drivers
      set full_name = coalesce(nullif(trim(full_name), ''), d_name),
          email = coalesce(nullif(trim(email), ''), d_email),
          phone = coalesce(nullif(trim(phone), ''), d_phone),
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
$replacement_definition$;
  IF (SELECT proacl::text FROM pg_proc WHERE oid='public.sync_bolt_fleet(jsonb,jsonb,jsonb,timestamp with time zone)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'Function permissions changed: sync_bolt_fleet';
  END IF;
  IF pg_get_functiondef('public.sync_uber_driver_status(jsonb)'::regprocedure) IS DISTINCT FROM $original_definition$CREATE OR REPLACE FUNCTION public.sync_uber_driver_status(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb; matched_count integer:=0; created_count integer:=0; skipped_count integer:=0;
  v_driver_id uuid; v_uuid text; v_status text; v_name text; v_email text; v_phone text; v_last_online timestamptz; v_realtime text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service_role required'; end if;
  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_uuid:=nullif(trim(r->>'uber_driver_uuid'),''); v_status:=upper(nullif(trim(r->>'status'),''));
    v_name:=nullif(trim(r->>'full_name'),''); v_email:=nullif(lower(trim(r->>'email')),''); v_phone:=nullif(trim(r->>'phone'),'');
    v_realtime:=upper(nullif(trim(r->>'realtime_status'),''));
    if v_uuid is null or v_status is null or v_status not in ('ACTIVE','ACCEPTED') then skipped_count:=skipped_count+1; continue; end if;
    begin v_last_online:=nullif(r->>'last_online_at','')::timestamptz; exception when others then v_last_online:=null; end;
    v_driver_id:=public.fleet_resolve_driver_identity('uber',v_uuid,v_name,v_email,v_phone);
    if v_driver_id is null then
      insert into public.drivers(full_name,email,phone,status,uber_driver_uuid,uber_status,uber_realtime_status,uber_status_at,uber_last_online_at,uber_status_raw,uber_last_synced_at)
      values(coalesce(v_name,'Motorista Uber'),v_email,v_phone,'Ativo',v_uuid,v_status,v_realtime,coalesce(nullif(r->>'observed_at','')::timestamptz,now()),v_last_online,coalesce(r->'raw','{}'::jsonb),now())
      returning id into v_driver_id; created_count:=created_count+1;
    else
      update public.drivers set full_name=coalesce(nullif(trim(full_name),''),v_name),email=coalesce(nullif(trim(email),''),v_email),phone=coalesce(nullif(trim(phone),''),v_phone),
        status='Ativo',uber_driver_uuid=v_uuid,uber_status=v_status,uber_realtime_status=v_realtime,
        uber_status_at=coalesce(nullif(r->>'observed_at','')::timestamptz,now()),uber_last_online_at=v_last_online,
        uber_status_raw=coalesce(r->'raw','{}'::jsonb),uber_last_synced_at=now(),updated_at=now()
      where id=v_driver_id; matched_count:=matched_count+1;
    end if;
  end loop;
  return jsonb_build_object('matched',matched_count,'created',created_count,'skipped',skipped_count);
end;
$function$
$original_definition$ THEN
    RAISE EXCEPTION 'Definition changed since review: sync_uber_driver_status';
  END IF;
  EXECUTE $replacement_definition$CREATE OR REPLACE FUNCTION public.sync_uber_driver_status(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb; matched_count integer:=0; created_count integer:=0; skipped_count integer:=0;
  v_driver_id uuid; v_uuid text; v_status text; v_name text; v_email text; v_phone text; v_last_online timestamptz; v_realtime text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service_role required'; end if;
  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_uuid:=nullif(trim(r->>'uber_driver_uuid'),''); v_status:=upper(nullif(trim(r->>'status'),''));
    v_name:=nullif(trim(r->>'full_name'),''); v_email:=nullif(lower(trim(r->>'email')),''); v_phone:=nullif(trim(r->>'phone'),'');
    v_realtime:=upper(nullif(trim(r->>'realtime_status'),''));
    if v_uuid is null or v_status is null or v_status not in ('ACTIVE','ACCEPTED') then skipped_count:=skipped_count+1; continue; end if;
    begin v_last_online:=nullif(r->>'last_online_at','')::timestamptz; exception when others then v_last_online:=null; end;
    v_driver_id:=public.fleet_resolve_driver_identity('uber',v_uuid,v_name,v_email,v_phone);
    if v_driver_id is null then
      insert into public.drivers(full_name,email,phone,status,uber_driver_uuid,uber_status,uber_realtime_status,uber_status_at,uber_last_online_at,uber_status_raw,uber_last_synced_at)
      values(coalesce(v_name,'Motorista Uber'),v_email,v_phone,'Ativo',v_uuid,v_status,v_realtime,coalesce(nullif(r->>'observed_at','')::timestamptz,now()),v_last_online,coalesce(r->'raw','{}'::jsonb),now())
      returning id into v_driver_id; created_count:=created_count+1;
    else
      update public.drivers set full_name=coalesce(nullif(trim(full_name),''),v_name),email=coalesce(nullif(trim(email),''),v_email),phone=coalesce(nullif(trim(phone),''),v_phone),
        uber_driver_uuid=v_uuid,uber_status=v_status,uber_realtime_status=v_realtime,
        uber_status_at=coalesce(nullif(r->>'observed_at','')::timestamptz,now()),uber_last_online_at=v_last_online,
        uber_status_raw=coalesce(r->'raw','{}'::jsonb),uber_last_synced_at=now(),updated_at=now()
      where id=v_driver_id; matched_count:=matched_count+1;
    end if;
  end loop;
  return jsonb_build_object('matched',matched_count,'created',created_count,'skipped',skipped_count);
end;
$function$
$replacement_definition$;
  IF (SELECT proacl::text FROM pg_proc WHERE oid='public.sync_uber_driver_status(jsonb)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'Function permissions changed: sync_uber_driver_status';
  END IF;
  SELECT jsonb_agg(to_jsonb(d) ORDER BY id) INTO after_rows FROM public.drivers d;
  IF before_rows IS DISTINCT FROM after_rows THEN RAISE EXCEPTION 'Driver data changed during function deployment'; END IF;
END;
$fleet_lifecycle_deploy$;
