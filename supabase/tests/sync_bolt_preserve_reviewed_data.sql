-- Run inside a transaction after loading ../sql/sync-bolt-preserve-reviewed-data.sql.
-- Always ROLLBACK after this regression test; it creates isolated fixture rows.
DO $test$
DECLARE
  v_id uuid;
  d_id uuid;
  a_id uuid;
  bolt_v_id text := gen_random_uuid()::text;
  bolt_d_id text := gen_random_uuid()::text;
  plate_value text := 'TEST-' || substr(gen_random_uuid()::text, 1, 8);
  fixed_vin text := 'WVWZZZ1KZ6W000001';
  result jsonb;
BEGIN
  INSERT INTO public.vehicles(plate,brand,model,vehicle_year,vin,bolt_vehicle_uuid)
  VALUES(plate_value,'Volkswagen','Golf',2020,fixed_vin,bolt_v_id) RETURNING id INTO v_id;
  INSERT INTO public.drivers(full_name,email,phone,bolt_driver_uuid)
  VALUES('Reviewed driver','primary@example.invalid','+351900000001',bolt_d_id) RETURNING id INTO d_id;
  INSERT INTO public.vehicle_assignments(vehicle_id,driver_id,active_from,source)
  VALUES(v_id,d_id,'2020-01-01','manual') RETURNING id INTO a_id;

  SELECT public.sync_bolt_fleet(
    jsonb_build_array(jsonb_build_object('bolt_driver_uuid',bolt_d_id,'full_name','Platform alias','email','bolt@example.invalid','phone','+351900000002')),
    jsonb_build_array(jsonb_build_object('bolt_vehicle_uuid',bolt_v_id,'plate',plate_value,'brand','Bolt','model','Veículo Bolt','vehicle_year',1999,'vin','INVALID-VIN')),
    '[]'::jsonb
  ) INTO result;
  IF NOT EXISTS(SELECT 1 FROM public.vehicles WHERE id=v_id AND brand='Volkswagen' AND model='Golf' AND vehicle_year=2020 AND vin=fixed_vin) THEN
    RAISE EXCEPTION 'Reviewed vehicle identity overwritten';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=d_id AND full_name='Reviewed driver' AND email='primary@example.invalid' AND phone='+351900000001') THEN
    RAISE EXCEPTION 'Primary driver contacts overwritten';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vehicle_assignments WHERE id=a_id AND active_from='2020-01-01' AND source='manual') THEN
    RAISE EXCEPTION 'Assignment deleted or replaced';
  END IF;
  IF (result->>'assignmentsUpdated')::integer <> 0 THEN
    RAISE EXCEPTION 'Sync unexpectedly updated assignments';
  END IF;

  PERFORM public.sync_bolt_fleet('[]',
    jsonb_build_array(jsonb_build_object('bolt_vehicle_uuid',bolt_v_id,'plate',plate_value,'brand','Fiat','model','Tipo','vehicle_year',2021,'vin','ZFA35600006R12009')), '[]');
  IF NOT EXISTS(SELECT 1 FROM public.vehicles WHERE id=v_id AND brand='Volkswagen' AND model='Golf' AND vehicle_year=2020 AND vin=fixed_vin) THEN
    RAISE EXCEPTION 'Conflicting platform values overwrote reviewed data';
  END IF;

  UPDATE public.vehicles SET brand='Bolt',model='Veículo Bolt',vehicle_year=NULL,vin='' WHERE id=v_id;
  PERFORM public.sync_bolt_fleet('[]',
    jsonb_build_array(jsonb_build_object('bolt_vehicle_uuid',bolt_v_id,'plate',plate_value,'brand','Fiat','model','Tipo','vehicle_year',2021,'vin','ZFA35600006R12009')), '[]');
  IF NOT EXISTS(SELECT 1 FROM public.vehicles WHERE id=v_id AND brand='Fiat' AND model='Tipo' AND vehicle_year=2021 AND vin='ZFA35600006R12009') THEN
    RAISE EXCEPTION 'Missing identity fields were not filled';
  END IF;
  RAISE NOTICE 'PASS: reviewed VIN/year/brand/model, primary contacts, assignment history, and missing-field fill';
END;
$test$;

-- Load ../sql/platform-driver-identity.sql before running this block.
-- Execute only in an isolated test database, inside a transaction and ROLLBACK.
DO $lifecycle$
DECLARE
  d_id uuid;
  bolt_id text := gen_random_uuid()::text;
  uber_id text := gen_random_uuid()::text;
  previous_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  INSERT INTO public.drivers(full_name,email,phone,status,bolt_driver_uuid,uber_driver_uuid)
  VALUES('Lifecycle regression','lifecycle-' || bolt_id || '@example.invalid',NULL,'Inativo',bolt_id,uber_id)
  RETURNING id INTO d_id;

  PERFORM public.sync_bolt_fleet(
    jsonb_build_array(jsonb_build_object('bolt_driver_uuid',bolt_id,'status','Ativo')),
    '[]','[]');
  IF (SELECT status FROM public.drivers WHERE id=d_id) IS DISTINCT FROM 'Inativo' THEN
    RAISE EXCEPTION 'Bolt reactivated an inactive Fleet driver';
  END IF;

  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM public.sync_uber_driver_status(
    jsonb_build_array(jsonb_build_object('uber_driver_uuid',uber_id,'status','ACTIVE')));
  IF (SELECT status FROM public.drivers WHERE id=d_id) IS DISTINCT FROM 'Inativo' THEN
    RAISE EXCEPTION 'Uber reactivated an inactive Fleet driver';
  END IF;

  UPDATE public.drivers SET status='Ativo' WHERE id=d_id;
  PERFORM public.sync_bolt_fleet(
    jsonb_build_array(jsonb_build_object('bolt_driver_uuid',bolt_id,'status','Inativo')),
    '[]','[]');
  IF (SELECT status FROM public.drivers WHERE id=d_id) IS DISTINCT FROM 'Ativo' THEN
    RAISE EXCEPTION 'Bolt account status deactivated an active Fleet driver';
  END IF;

  PERFORM public.sync_uber_driver_status(
    jsonb_build_array(jsonb_build_object('uber_driver_uuid',uber_id,'status','ACTIVE')));
  IF (SELECT status FROM public.drivers WHERE id=d_id) IS DISTINCT FROM 'Ativo' THEN
    RAISE EXCEPTION 'Uber changed an active Fleet driver lifecycle';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=d_id
    AND bolt_driver_uuid=bolt_id AND uber_driver_uuid=uber_id AND uber_status='ACTIVE') THEN
    RAISE EXCEPTION 'Lifecycle preservation lost platform identity or status observations';
  END IF;
  PERFORM set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
  RAISE NOTICE 'PASS: inactive Fleet drivers remain inactive; active drivers remain active; platform observations still update';
END;
$lifecycle$;
