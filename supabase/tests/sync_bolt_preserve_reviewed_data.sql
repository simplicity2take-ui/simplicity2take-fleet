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