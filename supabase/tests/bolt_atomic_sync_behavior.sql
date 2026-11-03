\set ON_ERROR_STOP on

BEGIN;

UPDATE public.drivers
SET bolt_driver_uuid = 'atomic-driver-company-b'
WHERE id = '20000000-0000-0000-0000-000000000105';

SELECT set_config('request.jwt.claim.role','service_role',true);
SET ROLE service_role;

DO $bolt_atomic_sync$
DECLARE
  company_id uuid;
  result jsonb;
  denied boolean := false;
  sync_at timestamptz := now();
  vehicle_id uuid := '30000000-0000-0000-0000-000000000020';
  driver_id uuid := '20000000-0000-0000-0000-000000000020';
  rollback_vehicle_id uuid := '30000000-0000-0000-0000-000000000021';
  rollback_driver_id uuid := '20000000-0000-0000-0000-000000000021';
BEGIN
  SELECT id INTO company_id FROM public.companies
  WHERE slug = 'simplicity2take' AND status = 'Ativa';

  result := public.s2t_apply_bolt_fleet_sync(
    company_id,
    jsonb_build_array(jsonb_build_object(
      'id', vehicle_id, 'is_new', true, 'plate', 'AT-20-AT',
      'brand', 'Toyota', 'model', 'Yaris', 'vehicle_year', 2024,
      'vin', 'ATOMIC-BOLT-VEHICLE-20', 'status', 'Ativo',
      'bolt_vehicle_uuid', 'atomic-bolt-vehicle-20'
    )),
    jsonb_build_array(jsonb_build_object(
      'id', driver_id, 'is_new', true, 'full_name', 'Motorista Bolt Atómico',
      'email', 'atomic-driver-20@example.test', 'phone', '910000020',
      'status', 'Ativo', 'bolt_driver_uuid', 'atomic-bolt-driver-20',
      'bolt_partner_uuid', 'atomic-bolt-partner-20', 'assigned_vehicle_id', vehicle_id
    )),
    sync_at
  );

  IF result #>> '{vehicles,created}' <> '1'
     OR result #>> '{drivers,created}' <> '1'
     OR result #>> '{assignments,created}' <> '1' THEN
    RAISE EXCEPTION 'Initial atomic Bolt sync did not create the expected fleet rows: %', result;
  END IF;

  result := public.s2t_apply_bolt_fleet_sync(
    company_id,
    jsonb_build_array(jsonb_build_object(
      'id', vehicle_id, 'is_new', false, 'plate', 'AT-20-AT',
      'brand', 'Toyota', 'model', 'Yaris', 'vehicle_year', 2024,
      'vin', 'ATOMIC-BOLT-VEHICLE-20', 'status', 'Ativo',
      'bolt_vehicle_uuid', 'atomic-bolt-vehicle-20'
    )),
    jsonb_build_array(jsonb_build_object(
      'id', driver_id, 'is_new', false, 'full_name', 'Motorista Bolt Atómico',
      'email', 'atomic-driver-20@example.test', 'phone', '910000020',
      'status', 'Ativo', 'bolt_driver_uuid', 'atomic-bolt-driver-20',
      'bolt_partner_uuid', 'atomic-bolt-partner-20', 'assigned_vehicle_id', vehicle_id
    )),
    sync_at
  );

  IF result #>> '{vehicles,created}' <> '0'
     OR result #>> '{drivers,created}' <> '0'
     OR result #>> '{assignments,created}' <> '0'
     OR result #>> '{assignments,conflictsRequiringReview}' <> '0' THEN
    RAISE EXCEPTION 'Atomic Bolt retry was not idempotent: %', result;
  END IF;

  result := public.s2t_apply_bolt_fleet_sync(
    company_id,
    jsonb_build_array(jsonb_build_object(
      'id', vehicle_id, 'is_new', false, 'plate', 'AT-20-AT',
      'brand', 'Toyota', 'model', 'Yaris', 'vehicle_year', 2024,
      'vin', 'ATOMIC-BOLT-VEHICLE-20', 'status', 'Inativo',
      'bolt_vehicle_uuid', 'atomic-bolt-vehicle-20'
    )),
    jsonb_build_array(jsonb_build_object(
      'id', driver_id, 'is_new', false, 'full_name', 'Motorista Bolt Atómico',
      'email', 'atomic-driver-20@example.test', 'phone', '910000020',
      'status', 'Inativo', 'bolt_driver_uuid', 'atomic-bolt-driver-20',
      'bolt_partner_uuid', 'atomic-bolt-partner-20', 'assigned_vehicle_id', vehicle_id
    )),
    sync_at
  );

  IF result #>> '{statusConflictsRequiringReview,drivers}' <> '1'
     OR result #>> '{statusConflictsRequiringReview,vehicles}' <> '1'
     OR result #>> '{assignments,conflictsRequiringReview}' <> '1' THEN
    RAISE EXCEPTION 'Atomic Bolt sync did not surface assignment-backed status conflicts: %', result;
  END IF;
  IF (SELECT status FROM public.drivers WHERE id=driver_id) <> 'Ativo'
     OR (SELECT status FROM public.vehicles WHERE id=vehicle_id) <> 'Ativo' THEN
    RAISE EXCEPTION 'Atomic Bolt sync changed an assigned driver or vehicle to inactive';
  END IF;

  denied := false;
  BEGIN
    PERFORM public.s2t_apply_bolt_fleet_sync(
      company_id,
      jsonb_build_array(jsonb_build_object(
        'id', rollback_vehicle_id, 'is_new', true, 'plate', 'AT-21-AT',
        'brand', 'Toyota', 'model', 'Yaris', 'vehicle_year', 2024,
        'status', 'Ativo', 'bolt_vehicle_uuid', 'atomic-bolt-vehicle-21'
      )),
      jsonb_build_array(jsonb_build_object(
        'id', rollback_driver_id, 'is_new', true, 'full_name', 'Conflito Bolt',
        'email', 'atomic-driver-21@example.test', 'phone', '910000021',
        'status', 'Ativo', 'bolt_driver_uuid', 'atomic-driver-company-b',
        'assigned_vehicle_id', rollback_vehicle_id
      )),
      sync_at
    );
  EXCEPTION WHEN check_violation THEN
    denied := true;
  END;

  IF NOT denied THEN
    RAISE EXCEPTION 'Atomic Bolt sync accepted an identity owned by another company';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vehicles WHERE id=rollback_vehicle_id)
     OR EXISTS (SELECT 1 FROM public.drivers WHERE id=rollback_driver_id) THEN
    RAISE EXCEPTION 'Failed Bolt batch left partial vehicle or driver writes';
  END IF;
END;
$bolt_atomic_sync$;

RESET ROLE;
ROLLBACK;
