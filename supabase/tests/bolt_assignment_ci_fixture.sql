\set ON_ERROR_STOP on
-- Minimal disposable schema for compiling and exercising the Bolt RPC.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE public.drivers (id uuid PRIMARY KEY, status text NOT NULL);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, bolt_vehicle_uuid text, status text NOT NULL);
CREATE TABLE public.vehicle_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  active_from date NOT NULL,
  active_until date,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, driver_id, active_from)
);
INSERT INTO public.drivers VALUES
 ('a1000000-0000-0000-0000-000000000001','Ativo'),
 ('a1000000-0000-0000-0000-000000000002','Inativo'),
 ('a1000000-0000-0000-0000-000000000003','Ativo'),
 ('a1000000-0000-0000-0000-000000000004','Ativo');
INSERT INTO public.vehicles VALUES
 ('b2000000-0000-0000-0000-000000000001','bolt-vehicle-1','Ativo'),
 ('b2000000-0000-0000-0000-000000000002','bolt-vehicle-2','Ativo'),
 ('b2000000-0000-0000-0000-000000000003',NULL,'Ativo'),
 ('b2000000-0000-0000-0000-000000000004','bolt-vehicle-inactive','Inativo'),
 ('b2000000-0000-0000-0000-000000000005','bolt-race-1','Ativo'),
 ('b2000000-0000-0000-0000-000000000006','bolt-race-2','Ativo');
INSERT INTO public.vehicle_assignments
 (id,driver_id,vehicle_id,active_from,active_until,source) VALUES
 ('c3000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000002',current_date-2,NULL,'manual'),
 ('c3000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000002',current_date-3,current_date-2,'bolt'),
 ('c3000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000001',current_date-1,NULL,'bolt'),
 ('c3000000-0000-0000-0000-000000000004','a1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000002',current_date-4,NULL,'bolt'),
 ('c3000000-0000-0000-0000-000000000005','a1000000-0000-0000-0000-000000000003','b2000000-0000-0000-0000-000000000001',current_date+1,NULL,'manual');
