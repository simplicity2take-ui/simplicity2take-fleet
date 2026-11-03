\set ON_ERROR_STOP on

-- This regression runs after company_fleet_flow_behavior.sql created both tenants.
-- Provider payloads are synthetic; all writes are rolled back at the end.
BEGIN;

UPDATE public.drivers SET bolt_driver_uuid='bolt-driver-a', uber_driver_uuid='uber-driver-a'
WHERE id='20000000-0000-0000-0000-000000000001';
UPDATE public.drivers SET bolt_driver_uuid='bolt-driver-b', uber_driver_uuid='uber-driver-b'
WHERE id='20000000-0000-0000-0000-000000000105';
UPDATE public.vehicles SET bolt_vehicle_uuid='bolt-vehicle-a', uber_vehicle_uuid='uber-vehicle-a'
WHERE id='30000000-0000-0000-0000-000000000001';
UPDATE public.vehicles SET bolt_vehicle_uuid='bolt-vehicle-b', uber_vehicle_uuid='uber-vehicle-b'
WHERE id='30000000-0000-0000-0000-000000000105';

INSERT INTO public.platform_activity_events (
  company_id, platform, driver_id, vehicle_id, status, observed_at, event_key
)
VALUES
 ((SELECT id FROM public.companies WHERE slug='simplicity2take'),
  'uber','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
  'completed','2026-11-03T09:00:00Z','company-a-only'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'uber','20000000-0000-0000-0000-000000000105','30000000-0000-0000-0000-000000000105',
  'completed','2026-11-03T09:01:00Z','company-b-only');

INSERT INTO public.platform_trip_records (
  company_id, platform, source_trip_id, driver_id, vehicle_id, order_status, observed_at
)
VALUES
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','uber','shared-trip',
  '20000000-0000-0000-0000-000000000105','30000000-0000-0000-0000-000000000105',
  'company-b-original','2026-11-03T09:02:00Z');

INSERT INTO public.uber_driver_activity (
  company_id, driver_id, uber_driver_uuid, driver_name, completed_trips, period_start, period_end
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '20000000-0000-0000-0000-000000000105','uber-driver-b','Empresa B original',99,
  '2026-11-02','2026-11-03'
);
INSERT INTO public.uber_driver_payments (
  company_id, driver_id, uber_driver_uuid, driver_name, paid_to_you, period_start, period_end
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '20000000-0000-0000-0000-000000000105','uber-driver-b','Empresa B original',999,
  '2026-11-02','2026-11-03'
);
INSERT INTO public.uber_driver_quality (
  company_id, driver_id, uber_driver_uuid, driver_name, completed_trips, period_start, period_end
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '20000000-0000-0000-0000-000000000105','uber-driver-b','Empresa B original',99,
  '2026-11-02','2026-11-03'
);
INSERT INTO public.uber_driver_time_distance (
  company_id, driver_id, uber_driver_uuid, driver_name, opening_minutes, period_start, period_end
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '20000000-0000-0000-0000-000000000105','uber-driver-b','Empresa B original',999,
  '2026-11-02','2026-11-03'
);
INSERT INTO public.uber_vehicle_performance (
  company_id, vehicle_id, uber_vehicle_uuid, plate, total_earnings, total_trips, period_start, period_end
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '30000000-0000-0000-0000-000000000105','uber-vehicle-b','BB-01-BB',999,99,
  '2026-11-02','2026-11-03'
);
INSERT INTO public.uber_vehicle_time_distance (
  company_id, vehicle_id, uber_vehicle_uuid, plate, opening_minutes, period_start, period_end
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '30000000-0000-0000-0000-000000000105','uber-vehicle-b','BB-01-BB',999,
  '2026-11-02','2026-11-03'
);

SELECT set_config('request.jwt.claim.role','service_role',true);
SET ROLE service_role;

DO $provider_rpcs$
DECLARE
  result jsonb;
BEGIN
  result := public.sync_bolt_activity(
    '[{"driver_uuid":"bolt-driver-b","vehicle_uuid":"bolt-vehicle-b","state":"online","created_at":"2026-11-03T10:00:00Z","event_key":"bolt-from-other-tenant"}]'::jsonb,
    '[{"source_trip_id":"bolt-shared-trip","driver_uuid":"bolt-driver-b","vehicle_uuid":"bolt-vehicle-b","vehicle_plate":"BB-01-BB","order_status":"finished","finished_at":"2026-11-03T10:00:00Z"}]'::jsonb
  );
  IF result->>'eventsUpserted' <> '1' OR result->>'tripsUpserted' <> '1' THEN
    RAISE EXCEPTION 'Bolt import did not accept the synthetic event and trip: %', result;
  END IF;

  result := public.sync_uber_driver_status(
    '[{"uber_driver_uuid":"uber-new-driver","status":"ACTIVE","realtime_status":"AVAILABLE","full_name":"Novo motorista Uber","observed_at":"2026-11-03T10:01:00Z"},{"uber_driver_uuid":"uber-pending-driver","status":"PENDING","full_name":"Pendente","observed_at":"2026-11-03T10:01:00Z"}]'::jsonb
  );
  IF result->>'created' <> '1' OR result->>'skipped' <> '1' THEN
    RAISE EXCEPTION 'Uber driver status import did not scope accepted states: %', result;
  END IF;

  result := public.sync_uber_driver_activity(
    '[{"uber_driver_uuid":"uber-driver-b","driver_name":"Motorista B1","completed_trips":"12","online_duration_minutes":"180","trip_duration_minutes":"92","period_start":"2026-11-02","period_end":"2026-11-03"}]'::jsonb
  );
  IF result->>'saved' <> '1' THEN
    RAISE EXCEPTION 'Uber driver report did not save: %', result;
  END IF;

  result := public.sync_uber_driver_payments(
    '[{"uber_driver_uuid":"uber-driver-b","driver_name":"Motorista B1","paid_to_you":"85.5","earnings":"90","cash_received":"4.5","fare":"82","taxes":"1","service_fee":"2","tolls":"0","tips":"3","adjustments":"0","period_start":"2026-11-02","period_end":"2026-11-03"}]'::jsonb
  );
  IF result->>'saved' <> '1' THEN
    RAISE EXCEPTION 'Uber driver payments report did not save: %', result;
  END IF;

  result := public.sync_uber_driver_quality(
    '[{"uber_driver_uuid":"uber-driver-b","driver_name":"Motorista B1","completed_trips":"12","acceptance_rate":"98.5","cancellation_rate":"1.5","completion_rate":"98.5","rating_last_4_weeks":"4.9","rating_last_500_trips":"4.8","current_acceptance_rate":"98","current_cancellation_rate":"2","accepted_trips":"12","rejected_trips":"1","cancelled_trips":"0","driver_cancelled_trips":"0","failed_trips":"0","total_trip_assignments":"13","period_start":"2026-11-02","period_end":"2026-11-03"}]'::jsonb
  );
  IF result->>'saved' <> '1' THEN
    RAISE EXCEPTION 'Uber driver quality report did not save: %', result;
  END IF;

  result := public.sync_uber_driver_time_distance(
    '[{"uber_driver_uuid":"uber-driver-b","driver_name":"Motorista B1","opening_minutes":"180","route_minutes":"100","trip_minutes":"80","unavailable_minutes":"0","free_distance_km":"3.5","route_distance_km":"42","trip_distance_km":"36","unavailable_distance_km":"0","period_start":"2026-11-02","period_end":"2026-11-03"}]'::jsonb
  );
  IF result->>'saved' <> '1' THEN
    RAISE EXCEPTION 'Uber driver time/distance report did not save: %', result;
  END IF;

  result := public.sync_uber_vehicle_performance(
    '[{"uber_vehicle_uuid":"uber-vehicle-b","plate":"BB-01-BB","total_earnings":"85.5","total_trips":"4","period_start":"2026-11-02","period_end":"2026-11-03"}]'::jsonb
  );
  IF result->>'saved' <> '1' THEN
    RAISE EXCEPTION 'Uber vehicle report did not save: %', result;
  END IF;

  result := public.sync_uber_vehicle_time_distance(
    '[{"uber_vehicle_uuid":"uber-vehicle-b","plate":"BB-01-BB","opening_minutes":"240","route_minutes":"140","trip_minutes":"100","unavailable_minutes":"0","free_distance_km":"4","route_distance_km":"50","trip_distance_km":"43","unavailable_distance_km":"0","period_start":"2026-11-02","period_end":"2026-11-03"}]'::jsonb
  );
  IF result->>'saved' <> '1' THEN
    RAISE EXCEPTION 'Uber vehicle time/distance report did not save: %', result;
  END IF;

  result := public.sync_uber_trip_activity(
    '[{"source_trip_id":"shared-trip","driver_id":"20000000-0000-0000-0000-000000000001","vehicle_id":"30000000-0000-0000-0000-000000000001","platform_driver_uuid":"uber-driver-a","platform_vehicle_uuid":"uber-vehicle-a","vehicle_plate":"AA-01-AA","order_status":"finished","finished_at":"2026-11-03T10:02:00Z"}]'::jsonb
  );
  IF result->>'saved' <> '1' THEN
    RAISE EXCEPTION 'Valid Uber trip import failed on a tenant-scoped duplicate trip key: %', result;
  END IF;

  result := NULL;
  BEGIN
    result := public.sync_uber_trip_activity(
      '[{"source_trip_id":"cross-company-trip","driver_id":"20000000-0000-0000-0000-000000000105","vehicle_id":"30000000-0000-0000-0000-000000000105","platform_driver_uuid":"uber-driver-b","platform_vehicle_uuid":"uber-vehicle-b","vehicle_plate":"BB-01-BB","order_status":"finished"}]'::jsonb
    );
  EXCEPTION WHEN check_violation THEN
    result := jsonb_build_object('rejected',true);
  END;
  IF coalesce(result->>'rejected','false') <> 'true' THEN
    RAISE EXCEPTION 'Uber trip RPC accepted internal IDs owned by another company';
  END IF;
END;
$provider_rpcs$;

RESET ROLE;

DO $tenant_rows$
DECLARE
  company_a uuid;
BEGIN
  SELECT id INTO company_a FROM public.companies WHERE slug='simplicity2take';

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_activity_events
    WHERE company_id=company_a AND event_key='bolt-from-other-tenant'
      AND platform='bolt' AND driver_id IS NULL AND vehicle_id IS NULL
      AND platform_driver_uuid='bolt-driver-b' AND platform_vehicle_uuid='bolt-vehicle-b'
  ) THEN RAISE EXCEPTION 'Bolt event was not isolated from Company B identities'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_trip_records
    WHERE company_id=company_a AND platform='bolt' AND source_trip_id='bolt-shared-trip'
      AND driver_id IS NULL AND vehicle_id IS NULL
  ) THEN RAISE EXCEPTION 'Bolt trip was not isolated from Company B identities'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.uber_driver_activity
    WHERE company_id=company_a AND uber_driver_uuid='uber-driver-b' AND driver_id IS NULL
  ) THEN RAISE EXCEPTION 'Uber driver report linked an identity from another company'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.uber_vehicle_performance
    WHERE company_id=company_a AND uber_vehicle_uuid='uber-vehicle-b' AND vehicle_id IS NULL
  ) THEN RAISE EXCEPTION 'Uber vehicle report linked a vehicle from another company'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.uber_driver_payments
    WHERE company_id=company_a AND uber_driver_uuid='uber-driver-b'
      AND driver_id IS NULL AND paid_to_you=85.5
  ) THEN RAISE EXCEPTION 'Uber driver payments linked a driver from another company'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.uber_driver_quality
    WHERE company_id=company_a AND uber_driver_uuid='uber-driver-b'
      AND driver_id IS NULL AND completed_trips=12
  ) THEN RAISE EXCEPTION 'Uber driver quality linked a driver from another company'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.uber_driver_time_distance
    WHERE company_id=company_a AND uber_driver_uuid='uber-driver-b'
      AND driver_id IS NULL AND opening_minutes=180
  ) THEN RAISE EXCEPTION 'Uber driver time/distance linked a driver from another company'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.uber_vehicle_time_distance
    WHERE company_id=company_a AND uber_vehicle_uuid='uber-vehicle-b'
      AND vehicle_id IS NULL AND opening_minutes=240
  ) THEN RAISE EXCEPTION 'Uber vehicle time/distance linked a vehicle from another company'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.uber_driver_activity
    WHERE company_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND uber_driver_uuid='uber-driver-b' AND driver_name='Empresa B original' AND completed_trips=99
  ) OR NOT EXISTS (
    SELECT 1 FROM public.uber_driver_payments
    WHERE company_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND uber_driver_uuid='uber-driver-b' AND driver_name='Empresa B original' AND paid_to_you=999
  ) OR NOT EXISTS (
    SELECT 1 FROM public.uber_driver_quality
    WHERE company_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND uber_driver_uuid='uber-driver-b' AND driver_name='Empresa B original' AND completed_trips=99
  ) OR NOT EXISTS (
    SELECT 1 FROM public.uber_driver_time_distance
    WHERE company_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND uber_driver_uuid='uber-driver-b' AND driver_name='Empresa B original' AND opening_minutes=999
  ) OR NOT EXISTS (
    SELECT 1 FROM public.uber_vehicle_performance
    WHERE company_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND uber_vehicle_uuid='uber-vehicle-b' AND total_earnings=999 AND total_trips=99
  ) OR NOT EXISTS (
    SELECT 1 FROM public.uber_vehicle_time_distance
    WHERE company_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND uber_vehicle_uuid='uber-vehicle-b' AND opening_minutes=999
  ) THEN RAISE EXCEPTION 'An S2T Uber report changed Company B data'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.drivers
    WHERE company_id=company_a AND uber_driver_uuid='uber-new-driver'
      AND uber_status='ACTIVE' AND uber_realtime_status='AVAILABLE'
  ) THEN RAISE EXCEPTION 'Uber status did not create the accepted S2T driver'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_trip_records
    WHERE company_id=company_a AND platform='uber' AND source_trip_id='shared-trip'
      AND driver_id='20000000-0000-0000-0000-000000000001'
      AND vehicle_id='30000000-0000-0000-0000-000000000001'
  ) THEN RAISE EXCEPTION 'Valid Uber trip did not link to S2T identities'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_trip_records
    WHERE company_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND platform='uber' AND source_trip_id='shared-trip'
      AND order_status='company-b-original'
      AND driver_id='20000000-0000-0000-0000-000000000105'
      AND vehicle_id='30000000-0000-0000-0000-000000000105'
  ) THEN RAISE EXCEPTION 'Uber trip upsert changed Company B history'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.platform_trip_records WHERE source_trip_id='cross-company-trip'
  ) THEN RAISE EXCEPTION 'Cross-company Uber trip row was persisted'; END IF;
END;
$tenant_rows$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);

DO $company_b_history$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_activity_events WHERE event_key='company-b-only'
  ) THEN RAISE EXCEPTION 'Company B cannot read its own platform event'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.platform_activity_events
    WHERE event_key IN ('company-a-only','bolt-from-other-tenant')
  ) THEN RAISE EXCEPTION 'Company B can read another company platform event'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_trip_records
    WHERE platform='uber' AND source_trip_id='shared-trip'
      AND order_status='company-b-original'
  ) THEN RAISE EXCEPTION 'Company B cannot read its original trip history'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.platform_trip_records
    WHERE platform='uber' AND source_trip_id='shared-trip'
      AND order_status IS DISTINCT FROM 'company-b-original'
  ) THEN RAISE EXCEPTION 'Company B can read the S2T trip with a matching provider ID'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.platform_trip_records
    WHERE source_trip_id='bolt-shared-trip'
  ) THEN RAISE EXCEPTION 'Company B can read a Bolt trip belonging to S2T'; END IF;
END;
$company_b_history$;

RESET ROLE;
ROLLBACK;
