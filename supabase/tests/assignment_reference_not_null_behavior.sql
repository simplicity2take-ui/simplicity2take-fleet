\set ON_ERROR_STOP on

BEGIN;
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', false);

DO $test$
DECLARE
  company_id uuid;
  driver_id uuid := '20000000-0000-0000-0000-000000000080';
  vehicle_id uuid := '30000000-0000-0000-0000-000000000080';
  denied boolean;
BEGIN
  SELECT id INTO company_id
  FROM public.companies
  WHERE slug = 'simplicity2take';

  INSERT INTO public.drivers (id, company_id, full_name, email, phone, status)
  VALUES (driver_id, company_id, 'Motorista Referência', 'assignment-reference@example.test', '910000080', 'Ativo');
  INSERT INTO public.vehicles (id, company_id, plate, brand, model, vehicle_year, status)
  VALUES (vehicle_id, company_id, 'AF-80-AF', 'Toyota', 'Yaris', 2024, 'Ativo');

  denied := false;
  BEGIN
    INSERT INTO public.vehicle_assignments (driver_id, vehicle_id, active_from)
    VALUES (NULL, vehicle_id, current_date);
  EXCEPTION WHEN not_null_violation THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'A vehicle assignment accepted a NULL driver_id';
  END IF;

  denied := false;
  BEGIN
    INSERT INTO public.vehicle_assignments (driver_id, vehicle_id, active_from)
    VALUES (driver_id, NULL, current_date);
  EXCEPTION WHEN not_null_violation THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'A vehicle assignment accepted a NULL vehicle_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.vehicle_assignments va
    WHERE va.driver_id IS NULL OR va.vehicle_id IS NULL
  ) THEN
    RAISE EXCEPTION 'A rejected NULL assignment left a partial row';
  END IF;
END;
$test$;

ROLLBACK;
