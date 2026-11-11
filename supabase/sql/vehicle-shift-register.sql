-- Read-only source registration. Drivers and vehicle assignments are not modified.
CREATE TABLE public.vehicle_shift_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file_id text NOT NULL,
  source_sheet_id text NOT NULL,
  source_row integer NOT NULL CHECK (source_row > 1),
  source_url text NOT NULL,
  source_timezone text NOT NULL,
  source_hash text NOT NULL,
  source_timestamp text NOT NULL,
  registered_at timestamptz,
  event_kind text CHECK (event_kind IN ('entry','exit')),
  driver_name text NOT NULL,
  vehicle_plate text NOT NULL,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  review_flags text[] NOT NULL DEFAULT '{}',
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_file_id, source_sheet_id, source_row)
);
CREATE INDEX vehicle_shift_events_registered_at_idx ON public.vehicle_shift_events(registered_at,id);
ALTER TABLE public.vehicle_shift_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_shift_events FROM anon, authenticated;
GRANT SELECT ON public.vehicle_shift_events TO authenticated;
GRANT ALL ON public.vehicle_shift_events TO service_role;
CREATE POLICY "shift register admin read" ON public.vehicle_shift_events FOR SELECT TO authenticated
  USING ((SELECT public.s2t_is_admin()));
