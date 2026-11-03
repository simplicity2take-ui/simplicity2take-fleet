\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  kept uuid;
  repeated uuid;
  err text;
BEGIN
  kept := public.reconcile_bolt_vehicle_assignment(
    'a1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000001',current_date);
  IF kept IS DISTINCT FROM 'c3000000-0000-0000-0000-000000000003'::uuid THEN
    RAISE EXCEPTION 'matching open Bolt row was not retained';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_assignments WHERE id='c3000000-0000-0000-0000-000000000004') THEN
    RAISE EXCEPTION 'competing open Bolt row was not removed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_assignments WHERE id='c3000000-0000-0000-0000-000000000001' AND source='manual' AND active_until IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.vehicle_assignments WHERE id='c3000000-0000-0000-0000-000000000002' AND source='bolt' AND active_until IS NOT NULL) THEN
    RAISE EXCEPTION 'manual or closed historical assignment was changed';
  END IF;

  kept := public.reconcile_bolt_vehicle_assignment(
    'a1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000002',current_date);
  repeated := public.reconcile_bolt_vehicle_assignment(
    'a1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000002',current_date);
  IF repeated IS DISTINCT FROM kept THEN RAISE EXCEPTION 'reconciliation is not idempotent'; END IF;
  IF (SELECT count(*) FROM public.vehicle_assignments WHERE driver_id='a1000000-0000-0000-0000-000000000001' AND source='bolt' AND active_until IS NULL) <> 1 THEN
    RAISE EXCEPTION 'driver does not have exactly one open Bolt row';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_assignments WHERE id='c3000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION 'previous open Bolt assignment was not replaced';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_assignments WHERE id='c3000000-0000-0000-0000-000000000001')
     OR NOT EXISTS (SELECT 1 FROM public.vehicle_assignments WHERE id='c3000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'manual or historical assignment changed during replacement';
  END IF;

  err := NULL;
  BEGIN
    PERFORM public.reconcile_bolt_vehicle_assignment(NULL::uuid,'b2000000-0000-0000-0000-000000000001',current_date);
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  IF err IS NULL OR err NOT ILIKE '%driver_id and vehicle_id are required%' THEN RAISE EXCEPTION 'null identifiers were not rejected'; END IF;

  err := NULL;
  BEGIN
    PERFORM public.reconcile_bolt_vehicle_assignment('a1000000-0000-0000-0000-000000000002','b2000000-0000-0000-0000-000000000001',current_date);
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  IF err IS NULL OR err NOT ILIKE '%missing or inactive%' THEN RAISE EXCEPTION 'inactive driver was not rejected'; END IF;

  err := NULL;
  BEGIN
    PERFORM public.reconcile_bolt_vehicle_assignment('a1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000003',current_date);
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  IF err IS NULL OR err NOT ILIKE '%missing, inactive, or not linked to Bolt%' THEN RAISE EXCEPTION 'unlinked vehicle was not rejected'; END IF;

  err := NULL;
  BEGIN
    PERFORM public.reconcile_bolt_vehicle_assignment('a1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000004',current_date);
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  IF err IS NULL OR err NOT ILIKE '%missing, inactive, or not linked to Bolt%' THEN RAISE EXCEPTION 'inactive vehicle was not rejected'; END IF;

  err := NULL;
  BEGIN
    PERFORM public.reconcile_bolt_vehicle_assignment('a1000000-0000-0000-0000-000000000003','b2000000-0000-0000-0000-000000000001',current_date+1);
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  IF err IS NULL OR err NOT ILIKE '%manual or historical row preserved%' THEN RAISE EXCEPTION 'same-day manual collision was not rejected'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_assignments WHERE id='c3000000-0000-0000-0000-000000000005' AND source='manual') THEN
    RAISE EXCEPTION 'same-day collision changed the manual assignment';
  END IF;
END
$$;
ROLLBACK;
