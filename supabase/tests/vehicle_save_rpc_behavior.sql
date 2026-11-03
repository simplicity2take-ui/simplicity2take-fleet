\set ON_ERROR_STOP on

BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000099', false);

DO $test$
DECLARE
  company_a uuid;
  company_b uuid;
  vehicle_a uuid;
  vehicle_other uuid := '30000000-0000-0000-0000-000000000071';
  vehicle_rollback_plate text := 'AD-72-AD';
  vehicle_b uuid := '30000000-0000-0000-0000-000000000073';
  driver_a uuid := '20000000-0000-0000-0000-000000000070';
  driver_other uuid := '20000000-0000-0000-0000-000000000071';
  result jsonb;
  denied boolean;
BEGIN
  SELECT id INTO company_a FROM public.companies WHERE slug = 'simplicity2take';
  INSERT INTO public.companies (slug, legal_name, display_name)
  VALUES ('vehicle-rpc-company-b', 'Empresa B', 'Empresa B')
  ON CONFLICT (slug) DO NOTHING;
  SELECT id INTO company_b FROM public.companies WHERE slug = 'vehicle-rpc-company-b';

  INSERT INTO public.drivers (id, company_id, full_name, email, phone, status)
  VALUES
    (driver_a, company_a, 'Motorista RPC A', 'vehicle-rpc-a@example.test', '910000070', 'Ativo'),
    (driver_other, company_a, 'Motorista RPC B', 'vehicle-rpc-b@example.test', '910000071', 'Ativo');

  result := public.s2t_save_vehicle_with_assignments(
    null, company_a, 'AA-70-AA', 'Toyota', 'Yaris', 2024, null, 'Ativo', ARRAY[driver_a]
  );
  vehicle_a := (result->>'vehicle_id')::uuid;
  IF result->>'created' <> 'true' OR vehicle_a IS NULL
     OR result #>> '{assignment,created_assignments}' <> '1' THEN
    RAISE EXCEPTION 'Vehicle and initial driver assignment were not saved atomically: %', result;
  END IF;

  INSERT INTO public.vehicles (id, company_id, plate, brand, model, vehicle_year, status)
  VALUES
    (vehicle_other, company_a, 'AB-71-AB', 'Ford', 'Focus', 2023, 'Ativo'),
    (vehicle_b, company_b, 'BB-73-BB', 'Kia', 'Ceed', 2022, 'Ativo');
  PERFORM public.s2t_replace_vehicle_assignments(vehicle_other, ARRAY[driver_other]);

  result := public.s2t_save_vehicle_with_assignments(
    vehicle_a, company_a, 'AC-70-AC', 'Toyota', 'Yaris', 2025, null, 'Ativo', ARRAY[driver_a]
  );
  IF result->>'created' <> 'false'
     OR (SELECT plate FROM public.vehicles WHERE id = vehicle_a) <> 'AC-70-AC' THEN
    RAISE EXCEPTION 'Vehicle metadata update did not succeed: %', result;
  END IF;

  denied := false;
  BEGIN
    PERFORM public.s2t_save_vehicle_with_assignments(
      vehicle_a, company_a, 'CHANGED-70', 'Toyota', 'Yaris', 2025, null, 'Ativo', ARRAY[driver_other]
    );
  EXCEPTION WHEN unique_violation THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'A driver assigned to another vehicle was accepted';
  END IF;
  IF (SELECT plate FROM public.vehicles WHERE id = vehicle_a) <> 'AC-70-AC'
     OR NOT EXISTS (
       SELECT 1 FROM public.vehicle_assignments
       WHERE vehicle_id = vehicle_a AND driver_id = driver_a
         AND active_from <= current_date AND (active_until IS NULL OR active_until >= current_date)
     ) THEN
    RAISE EXCEPTION 'Failed existing-vehicle save left partial vehicle or assignment changes';
  END IF;

  denied := false;
  BEGIN
    PERFORM public.s2t_save_vehicle_with_assignments(
      null, company_a, vehicle_rollback_plate, 'Honda', 'Civic', 2021, null, 'Ativo', ARRAY[driver_other]
    );
  EXCEPTION WHEN unique_violation THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'Vehicle creation accepted an already assigned driver';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vehicles WHERE plate = vehicle_rollback_plate) THEN
    RAISE EXCEPTION 'Failed vehicle creation left a partial row';
  END IF;

  INSERT INTO public.company_memberships (company_id, profile_id, role, status)
  VALUES (company_a, '10000000-0000-0000-0000-000000000001', 'company_admin', 'Ativo');
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

  result := public.s2t_save_vehicle_with_assignments(
    null, company_a, 'AE-74-AE', 'Renault', 'Clio', 2020, null, 'Ativo', '{}'::uuid[]
  );
  IF result->>'created' <> 'true'
     OR NOT EXISTS (
       SELECT 1 FROM public.vehicles
       WHERE id = (result->>'vehicle_id')::uuid AND company_id = company_a
     ) THEN
    RAISE EXCEPTION 'Company administrator could not create a vehicle in its own company';
  END IF;

  denied := false;
  BEGIN
    PERFORM public.s2t_save_vehicle_with_assignments(
      vehicle_b, company_b, 'BC-73-BC', 'Kia', 'Ceed', 2022, null, 'Ativo', '{}'::uuid[]
    );
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'Company administrator changed a vehicle belonging to another company';
  END IF;
  IF (SELECT plate FROM public.vehicles WHERE id = vehicle_b) <> 'BB-73-BB' THEN
    RAISE EXCEPTION 'Unauthorized cross-company save changed the vehicle';
  END IF;
END;
$test$;

ROLLBACK;
