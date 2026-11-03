\set ON_ERROR_STOP on

DO $test$
DECLARE
  v_driver_not_null boolean;
  v_vehicle_not_null boolean;
BEGIN
  SELECT a.attnotnull INTO v_driver_not_null
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vehicle_assignments'::regclass
    AND a.attname = 'driver_id'
    AND NOT a.attisdropped;

  SELECT a.attnotnull INTO v_vehicle_not_null
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vehicle_assignments'::regclass
    AND a.attname = 'vehicle_id'
    AND NOT a.attisdropped;

  IF v_driver_not_null IS DISTINCT FROM true
     OR v_vehicle_not_null IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: vehicle assignment references must both be NOT NULL';
  END IF;

  RAISE NOTICE 'PASS: vehicle assignment driver_id and vehicle_id are NOT NULL';
END;
$test$;
