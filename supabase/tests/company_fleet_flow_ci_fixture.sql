\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $block$
BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE service_role BYPASSRLS;
END
$block$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  email text,
  status text NOT NULL DEFAULT 'Ativo',
  role text NOT NULL DEFAULT 'user'
);

CREATE TABLE public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text,
  phone text,
  status text NOT NULL DEFAULT 'Ativo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.drivers
  ADD COLUMN bolt_driver_uuid text,
  ADD COLUMN bolt_partner_uuid text,
  ADD COLUMN bolt_last_synced_at timestamptz,
  ADD COLUMN uber_driver_uuid text,
  ADD COLUMN uber_status text,
  ADD COLUMN uber_realtime_status text,
  ADD COLUMN uber_status_at timestamptz,
  ADD COLUMN uber_last_online_at timestamptz,
  ADD COLUMN uber_status_raw jsonb,
  ADD COLUMN uber_last_synced_at timestamptz;

CREATE UNIQUE INDEX drivers_bolt_driver_uuid_uidx
  ON public.drivers(bolt_driver_uuid) WHERE bolt_driver_uuid IS NOT NULL;

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate text NOT NULL UNIQUE,
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  vehicle_year integer,
  vin text,
  status text NOT NULL DEFAULT 'Ativo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vehicles
  ADD COLUMN bolt_vehicle_uuid text,
  ADD COLUMN bolt_last_synced_at timestamptz,
  ADD COLUMN uber_vehicle_uuid text;

CREATE UNIQUE INDEX vehicles_bolt_vehicle_uuid_uidx
  ON public.vehicles(bolt_vehicle_uuid) WHERE bolt_vehicle_uuid IS NOT NULL;


-- Provider history tables mirror the pre-tenant schema. Their legacy UNIQUE
-- constraints intentionally exercise the constraint-to-tenant-index migration.
CREATE TABLE public.platform_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('bolt','uber')),
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  platform_driver_uuid text,
  platform_vehicle_uuid text,
  status text NOT NULL,
  observed_at timestamptz NOT NULL,
  event_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.platform_trip_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('bolt','uber')),
  source_trip_id text NOT NULL,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  platform_driver_uuid text,
  platform_vehicle_uuid text,
  vehicle_plate text,
  order_status text,
  accepted_at timestamptz,
  pickup_at timestamptz,
  dropoff_at timestamptz,
  finished_at timestamptz,
  ride_distance_km numeric(12,3),
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, source_trip_id)
);

ALTER TABLE public.platform_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_trip_records ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.platform_activity_events, public.platform_trip_records TO authenticated;

CREATE TABLE public.uber_driver_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  uber_driver_uuid text,
  driver_name text,
  completed_trips integer,
  online_duration_minutes integer,
  trip_duration_minutes integer,
  period_start date NOT NULL,
  period_end date NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uber_driver_activity_uber_driver_uuid_period_start_period_e_key
    UNIQUE (uber_driver_uuid, period_start, period_end)
);

CREATE TABLE public.uber_driver_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  uber_driver_uuid text,
  driver_name text,
  paid_to_you numeric,
  earnings numeric,
  cash_received numeric,
  fare numeric,
  taxes numeric,
  service_fee numeric,
  tolls numeric,
  tips numeric,
  adjustments numeric,
  period_start date NOT NULL,
  period_end date NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uber_driver_payments_uber_driver_uuid_period_start_period_e_key
    UNIQUE (uber_driver_uuid, period_start, period_end)
);

CREATE TABLE public.uber_driver_quality (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  uber_driver_uuid text,
  driver_name text,
  completed_trips integer,
  acceptance_rate numeric,
  cancellation_rate numeric,
  completion_rate numeric,
  rating_last_4_weeks numeric,
  rating_last_500_trips numeric,
  current_acceptance_rate numeric,
  current_cancellation_rate numeric,
  accepted_trips integer,
  rejected_trips integer,
  cancelled_trips integer,
  driver_cancelled_trips integer,
  failed_trips integer,
  total_trip_assignments integer,
  period_start date NOT NULL,
  period_end date NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uber_driver_quality_uber_driver_uuid_period_start_period_en_key
    UNIQUE (uber_driver_uuid, period_start, period_end)
);

CREATE TABLE public.uber_driver_time_distance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  uber_driver_uuid text,
  driver_name text,
  opening_minutes integer,
  route_minutes integer,
  trip_minutes integer,
  unavailable_minutes integer,
  free_distance_km numeric,
  route_distance_km numeric,
  trip_distance_km numeric,
  unavailable_distance_km numeric,
  period_start date NOT NULL,
  period_end date NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uber_driver_time_distance_uber_driver_uuid_period_start_per_key
    UNIQUE (uber_driver_uuid, period_start, period_end)
);

CREATE TABLE public.uber_vehicle_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  uber_vehicle_uuid text,
  plate text,
  total_earnings numeric,
  earnings_per_hour numeric,
  cash_received numeric,
  trips_per_hour numeric,
  online_hours numeric,
  trip_hours numeric,
  work_hours numeric,
  total_trips integer,
  acceptance_rate numeric,
  cancellation_rate numeric,
  accepted_trips integer,
  rejected_trips integer,
  cancelled_trips integer,
  failed_trips integer,
  total_trip_assignments integer,
  period_start date NOT NULL,
  period_end date NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uber_vehicle_performance_uber_vehicle_uuid_period_start_per_key
    UNIQUE (uber_vehicle_uuid, period_start, period_end)
);

CREATE TABLE public.uber_vehicle_time_distance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  uber_vehicle_uuid text,
  plate text,
  opening_minutes integer,
  route_minutes integer,
  trip_minutes integer,
  unavailable_minutes integer,
  free_distance_km numeric,
  route_distance_km numeric,
  trip_distance_km numeric,
  unavailable_distance_km numeric,
  period_start date NOT NULL,
  period_end date NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uber_vehicle_time_distance_uber_vehicle_uuid_period_start_p_key
    UNIQUE (uber_vehicle_uuid, period_start, period_end)
);

CREATE TABLE public.vehicle_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  active_from date NOT NULL,
  active_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, driver_id, active_from)
);

INSERT INTO public.profiles (id, full_name, email, role) VALUES
 ('10000000-0000-0000-0000-000000000001','Admin Empresa A','admin-a@example.test','user'),
 ('10000000-0000-0000-0000-000000000002','Admin Empresa B','admin-b@example.test','user'),
 ('10000000-0000-0000-0000-000000000003','Membro Empresa A','member-a@example.test','user'),
 ('10000000-0000-0000-0000-000000000004','Motorista A','driver-a@example.test','driver'),
 ('10000000-0000-0000-0000-000000000005','Motorista B','driver-b@example.test','driver'),
 ('10000000-0000-0000-0000-000000000099','Admin Global','global-admin@example.test','admin');

CREATE OR REPLACE FUNCTION public.s2t_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
      AND coalesce(p.status, 'Ativo') = 'Ativo'
  );
$function$;

GRANT EXECUTE ON FUNCTION public.s2t_is_admin() TO authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drivers, public.vehicles, public.vehicle_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drivers, public.vehicles, public.vehicle_assignments TO service_role;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_assignments ENABLE ROW LEVEL SECURITY;
