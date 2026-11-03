\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_assignments ENABLE ROW LEVEL SECURITY;
