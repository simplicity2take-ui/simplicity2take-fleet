\set ON_ERROR_STOP on
BEGIN;

-- Expired and future history must be preserved and must not block a current Bolt assignment.
INSERT INTO public.vehicle_assignments (vehicle_id,driver_id,active_from,active_until)
VALUES ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',current_date-10,current_date-1);
INSERT INTO public.vehicle_assignments (vehicle_id,driver_id,active_from,active_until)
VALUES ('30000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000005',current_date+5,NULL);

-- Multiple-active rows are inserted after the future-only scenario is validated.

SELECT set_config('request.jwt.claim.role','service_role',true);
SET ROLE service_role;

DO $bolt_assignment_behavior$
DECLARE
  result jsonb;
  denied boolean := false;
BEGIN
  result := public.s2t_bolt_assign_vehicle(
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001'
  );
  IF result->>'action' <> 'created' THEN
    RAISE EXCEPTION 'Bolt did not create a valid assignment after expired history: %', result;
  END IF;

  result := public.s2t_bolt_assign_vehicle(
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001'
  );
  IF result->>'action' <> 'unchanged' THEN
    RAISE EXCEPTION 'Bolt did not report the existing exact pair as unchanged: %', result;
  END IF;

  result := public.s2t_bolt_assign_vehicle(
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000006'
  );
  IF result->>'action' <> 'conflict' THEN
    RAISE EXCEPTION 'Bolt replaced a driver active on another vehicle: %', result;
  END IF;

  result := public.s2t_bolt_assign_vehicle(
    '20000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000001'
  );
  IF result->>'action' <> 'conflict' THEN
    RAISE EXCEPTION 'Bolt assigned a vehicle already owned by another driver: %', result;
  END IF;

  result := public.s2t_bolt_assign_vehicle(
    '20000000-0000-0000-0000-000000000005',
    '30000000-0000-0000-0000-000000000006'
  );
  IF result->>'action' <> 'created' THEN
    RAISE EXCEPTION 'A future assignment incorrectly blocked a current Bolt assignment: %', result;
  END IF;

  INSERT INTO public.vehicle_assignments (vehicle_id,driver_id,active_from,active_until)
  VALUES ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000005',current_date-1,NULL);

  result := public.s2t_bolt_assign_vehicle(
    '20000000-0000-0000-0000-000000000005',
    '30000000-0000-0000-0000-000000000001'
  );
  IF result->>'action' <> 'conflict' OR result->>'reason' <> 'multiple_active_assignments' THEN
    RAISE EXCEPTION 'Bolt did not surface multiple active assignments for review: %', result;
  END IF;

  result := public.s2t_bolt_assign_vehicle(
    '20000000-0000-0000-0000-000000000004',
    '30000000-0000-0000-0000-000000000006'
  );
  IF result->>'action' <> 'conflict' OR result->>'reason' <> 'inactive_driver' THEN
    RAISE EXCEPTION 'Bolt assigned an inactive driver: %', result;
  END IF;

  result := public.s2t_bolt_assign_vehicle(
    '20000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000005'
  );
  IF result->>'action' <> 'conflict' OR result->>'reason' <> 'inactive_vehicle' THEN
    RAISE EXCEPTION 'Bolt assigned a vehicle archived by the fleet admin: %', result;
  END IF;

  BEGIN
    PERFORM public.s2t_bolt_assign_vehicle(
      '20000000-0000-0000-0000-000000000105',
      '30000000-0000-0000-0000-000000000105'
    );
  EXCEPTION WHEN no_data_found THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'Bolt assignment RPC accepted Company B identities';
  END IF;
END;
$bolt_assignment_behavior$;

RESET ROLE;

DO $bolt_assignment_rows$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_assignments
    WHERE driver_id='20000000-0000-0000-0000-000000000001'
      AND vehicle_id='30000000-0000-0000-0000-000000000001'
      AND active_from=current_date AND active_until IS NULL
  ) THEN RAISE EXCEPTION 'Bolt assignment was not persisted'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_assignments
    WHERE driver_id='20000000-0000-0000-0000-000000000001'
      AND vehicle_id='30000000-0000-0000-0000-000000000001'
      AND active_until=current_date-1
  ) THEN RAISE EXCEPTION 'Expired assignment history was changed'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_assignments
    WHERE driver_id='20000000-0000-0000-0000-000000000005'
      AND vehicle_id='30000000-0000-0000-0000-000000000006'
      AND active_from=current_date+5 AND active_until IS NULL
  ) THEN RAISE EXCEPTION 'Future assignment history was changed'; END IF;

  IF (SELECT count(*) FROM public.vehicle_assignments
      WHERE driver_id='20000000-0000-0000-0000-000000000005'
        AND active_from <= current_date
        AND (active_until IS NULL OR active_until >= current_date)) <> 2
  THEN RAISE EXCEPTION 'Multiple active assignment rows were altered'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.vehicle_assignments
    WHERE (driver_id='20000000-0000-0000-0000-000000000001' AND vehicle_id='30000000-0000-0000-0000-000000000006')
       OR (driver_id='20000000-0000-0000-0000-000000000003' AND vehicle_id='30000000-0000-0000-0000-000000000001')
       OR (driver_id='20000000-0000-0000-0000-000000000004' AND vehicle_id='30000000-0000-0000-0000-000000000006')
       OR (driver_id='20000000-0000-0000-0000-000000000003' AND vehicle_id='30000000-0000-0000-0000-000000000005')
  ) THEN RAISE EXCEPTION 'A conflicted Bolt assignment was persisted'; END IF;
END;
$bolt_assignment_rows$;

ROLLBACK;
