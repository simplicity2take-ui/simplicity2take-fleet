-- Reviewed installation only. No legacy Google records or assignments are changed.
CREATE TABLE public.driver_shift_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 driver_id uuid NOT NULL REFERENCES public.drivers(id),
 vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
 driver_name text NOT NULL, vehicle_plate text NOT NULL,
 is_test boolean NOT NULL DEFAULT true,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(), ended_at timestamptz,
 start_request_id uuid NOT NULL UNIQUE, end_request_id uuid UNIQUE,
 closure_kind text NOT NULL DEFAULT 'driver' CHECK (closure_kind IN ('driver','admin')),
 closure_note text, closed_by uuid REFERENCES public.profiles(id),
 trip_review jsonb NOT NULL DEFAULT '{"state":"pending","flags":["platform_coverage_unconfirmed"]}',
 cartrack_review jsonb NOT NULL DEFAULT '{"state":"pending","reason":"awaiting_history"}',
 reviewed_at timestamptz, next_review_at timestamptz NOT NULL DEFAULT now(),
 CHECK (ended_at IS NULL OR ended_at >= started_at),
 CHECK ((ended_at IS NULL) = (end_request_id IS NULL)),
 CHECK ((ended_at IS NULL) = (closed_by IS NULL)),
 CHECK (closure_kind<>'admin' OR (closure_note IS NOT NULL AND length(trim(closure_note)) BETWEEN 8 AND 500))
);
CREATE UNIQUE INDEX driver_shift_one_open_driver ON public.driver_shift_sessions(driver_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX driver_shift_one_open_vehicle ON public.driver_shift_sessions(vehicle_id) WHERE ended_at IS NULL;
CREATE INDEX driver_shift_started ON public.driver_shift_sessions(started_at,id);
ALTER TABLE public.driver_shift_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_shift_sessions FROM anon,authenticated;
GRANT SELECT ON public.driver_shift_sessions TO authenticated;
GRANT ALL ON public.driver_shift_sessions TO service_role;
CREATE POLICY native_shift_read ON public.driver_shift_sessions FOR SELECT TO authenticated USING (
 public.is_admin() OR EXISTS (SELECT 1 FROM public.drivers d JOIN public.profiles p ON p.id=d.profile_id
 WHERE d.id=driver_shift_sessions.driver_id AND p.id=auth.uid() AND p.role='driver' AND p.status='Ativo' AND d.status='Ativo')
);
CREATE SCHEMA IF NOT EXISTS fleet_private;
REVOKE ALL ON SCHEMA fleet_private FROM PUBLIC;
GRANT USAGE ON SCHEMA fleet_private TO authenticated;
-- Empty on installation: only explicitly enabled drivers may start shifts.
CREATE TABLE fleet_private.shift_access (
 driver_id uuid PRIMARY KEY REFERENCES public.drivers(id),
 enabled boolean NOT NULL DEFAULT true,
 test_mode boolean NOT NULL DEFAULT true
);
ALTER TABLE fleet_private.shift_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fleet_private.shift_access FROM PUBLIC,anon,authenticated;
GRANT ALL ON fleet_private.shift_access TO service_role;

-- Privileged writes are required to enforce vehicle exclusivity across drivers.
-- Every entry point resolves the active driver from auth.uid(), never client IDs.
CREATE FUNCTION fleet_private.active_shift_driver() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid; n integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão de motorista necessária.'; END IF;
 SELECT count(*),min(d.id::text)::uuid INTO n,result FROM public.drivers d JOIN public.profiles p ON p.id=d.profile_id
 WHERE p.id=auth.uid() AND p.role='driver' AND p.status='Ativo' AND d.status='Ativo';
 IF n<>1 THEN RAISE EXCEPTION 'Conta de motorista inativa ou não associada.'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION fleet_private.shift_vehicle(p_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.vehicles; did uuid; mode boolean;
BEGIN
 did:=fleet_private.active_shift_driver();
 SELECT test_mode INTO mode FROM fleet_private.shift_access WHERE driver_id=did AND enabled;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SHIFT_ACCESS_REQUIRED'; END IF;
 SELECT * INTO v FROM public.vehicles WHERE qr_token=p_token AND status='Ativo';
 IF v.id IS NULL THEN RAISE EXCEPTION 'QR de viatura inválido ou viatura indisponível.'; END IF;
 RETURN jsonb_build_object('id',v.id,'plate',v.plate,'brand',v.brand,'model',v.model,'is_test',mode);
END $$;

CREATE FUNCTION fleet_private.shift_start(p_token text,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.drivers; v public.vehicles; s public.driver_shift_sessions; did uuid; mode boolean;
BEGIN
 did:=fleet_private.active_shift_driver();
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Identificador do pedido em falta.'; END IF;
 SELECT * INTO d FROM public.drivers WHERE id=did FOR UPDATE;
 PERFORM fleet_private.active_shift_driver();
 -- Account activity is checked again after acquiring the per-driver lock.
 IF d.status<>'Ativo' THEN RAISE EXCEPTION 'Motorista inativo.'; END IF;
 SELECT test_mode INTO mode FROM fleet_private.shift_access WHERE driver_id=did AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SHIFT_ACCESS_REQUIRED'; END IF;
 SELECT * INTO v FROM public.vehicles WHERE qr_token=p_token FOR UPDATE;
 IF v.id IS NULL OR v.status<>'Ativo' THEN RAISE EXCEPTION 'QR de viatura inválido ou viatura indisponível.'; END IF;
 SELECT * INTO s FROM public.driver_shift_sessions WHERE start_request_id=p_request_id;
 IF s.id IS NOT NULL THEN
   IF s.driver_id<>did OR s.vehicle_id<>v.id THEN RAISE EXCEPTION 'Pedido não corresponde a este turno.'; END IF;
   RETURN to_jsonb(s);
 END IF;
 IF EXISTS(SELECT 1 FROM public.driver_shift_sessions WHERE driver_id=did AND ended_at IS NULL) THEN RAISE EXCEPTION 'Termine o turno aberto antes de iniciar outro.'; END IF;
 IF EXISTS(SELECT 1 FROM public.driver_shift_sessions WHERE vehicle_id=v.id AND ended_at IS NULL) THEN RAISE EXCEPTION 'Esta viatura tem um turno aberto. Peça a conferência ao administrador.'; END IF;
 INSERT INTO public.driver_shift_sessions(driver_id,vehicle_id,driver_name,vehicle_plate,start_request_id,is_test)
 VALUES(did,v.id,d.full_name,v.plate,p_request_id,mode) RETURNING * INTO s;
 RETURN to_jsonb(s);
END $$;

CREATE FUNCTION fleet_private.shift_end(p_shift_id uuid,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE did uuid; s public.driver_shift_sessions;
BEGIN
 did:=fleet_private.active_shift_driver();
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Identificador do pedido em falta.'; END IF;
 PERFORM 1 FROM public.drivers WHERE id=did AND status='Ativo' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Motorista inativo.'; END IF;
 PERFORM fleet_private.active_shift_driver();
 SELECT * INTO s FROM public.driver_shift_sessions WHERE id=p_shift_id AND driver_id=did FOR UPDATE;
 IF s.id IS NULL THEN RAISE EXCEPTION 'Turno não encontrado para esta conta.'; END IF;
 IF s.ended_at IS NOT NULL THEN
   IF s.end_request_id=p_request_id THEN RETURN to_jsonb(s); END IF;
   RAISE EXCEPTION 'Este turno já está terminado. Atualize a página.';
 END IF;
 UPDATE public.driver_shift_sessions SET ended_at=clock_timestamp(),end_request_id=p_request_id,closed_by=auth.uid(),next_review_at=clock_timestamp() WHERE id=s.id RETURNING * INTO s;
 RETURN to_jsonb(s);
END $$;

-- Administrative release records an action now, not an inferred historical exit.
CREATE FUNCTION fleet_private.shift_admin_close(p_shift_id uuid,p_request_id uuid,p_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE did uuid; s public.driver_shift_sessions;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrador ativo necessário.'; END IF;
 IF p_request_id IS NULL OR p_note IS NULL OR length(trim(p_note)) NOT BETWEEN 8 AND 500 THEN RAISE EXCEPTION 'Indique um motivo entre 8 e 500 caracteres.'; END IF;
 SELECT driver_id INTO did FROM public.driver_shift_sessions WHERE id=p_shift_id;
 IF did IS NULL THEN RAISE EXCEPTION 'Turno não encontrado.'; END IF;
 PERFORM 1 FROM public.drivers WHERE id=did FOR UPDATE;
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrador ativo necessário.'; END IF;
 SELECT * INTO s FROM public.driver_shift_sessions WHERE id=p_shift_id FOR UPDATE;
 IF s.ended_at IS NOT NULL THEN
   IF s.closure_kind='admin' AND s.closed_by=auth.uid() AND s.end_request_id=p_request_id AND s.closure_note=trim(p_note) THEN RETURN to_jsonb(s); END IF;
   RAISE EXCEPTION 'Turno já encerrado; atualize os registos.';
 END IF;
 UPDATE public.driver_shift_sessions SET ended_at=clock_timestamp(),end_request_id=p_request_id,closed_by=auth.uid(),
   closure_kind='admin',closure_note=trim(p_note),next_review_at=clock_timestamp(),
   trip_review='{"state":"review","flags":["admin_closure_requires_review","platform_coverage_unconfirmed"]}'::jsonb,
   cartrack_review='{"state":"pending","reason":"admin_closure_requires_review"}'::jsonb
 WHERE id=s.id RETURNING * INTO s;
 RETURN to_jsonb(s);
END $$;

REVOKE ALL ON FUNCTION fleet_private.active_shift_driver(),fleet_private.shift_vehicle(text),fleet_private.shift_start(text,uuid),fleet_private.shift_end(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION fleet_private.shift_admin_close(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION fleet_private.shift_admin_close(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION fleet_private.shift_vehicle(text),fleet_private.shift_start(text,uuid),fleet_private.shift_end(uuid,uuid) TO authenticated;
CREATE FUNCTION public.fleet_shift_vehicle(p_token text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT fleet_private.shift_vehicle(p_token) $$;
CREATE FUNCTION public.fleet_shift_start(p_token text,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT fleet_private.shift_start(p_token,p_request_id) $$;
CREATE FUNCTION public.fleet_shift_end(p_shift_id uuid,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT fleet_private.shift_end(p_shift_id,p_request_id) $$;
CREATE FUNCTION public.fleet_shift_admin_close(p_shift_id uuid,p_request_id uuid,p_note text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT fleet_private.shift_admin_close(p_shift_id,p_request_id,p_note) $$;
REVOKE ALL ON FUNCTION public.fleet_shift_admin_close(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fleet_shift_admin_close(uuid,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.fleet_shift_vehicle(text),public.fleet_shift_start(text,uuid),public.fleet_shift_end(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fleet_shift_vehicle(text),public.fleet_shift_start(text,uuid),public.fleet_shift_end(uuid,uuid) TO authenticated;
