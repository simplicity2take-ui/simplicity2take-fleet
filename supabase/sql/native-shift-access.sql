-- Safe feature discovery for staged rollout. Does not expose the private allowlist.
CREATE OR REPLACE FUNCTION fleet_private.shift_access_state() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE did uuid; n integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão de motorista necessária.'; END IF;
 SELECT count(*),min(d.id::text)::uuid INTO n,did
 FROM public.drivers d JOIN public.profiles p ON p.id=d.profile_id
 WHERE p.id=auth.uid() AND p.role='driver' AND p.status='Ativo' AND d.status='Ativo';
 IF n<>1 THEN RETURN jsonb_build_object('can_start',false,'has_open_shift',false); END IF;
 RETURN jsonb_build_object(
  'can_start',EXISTS(SELECT 1 FROM fleet_private.shift_access WHERE driver_id=did AND enabled),
  'has_open_shift',EXISTS(SELECT 1 FROM public.driver_shift_sessions WHERE driver_id=did AND ended_at IS NULL));
END $$;
REVOKE ALL ON FUNCTION fleet_private.shift_access_state() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION fleet_private.shift_access_state() TO authenticated;
CREATE OR REPLACE FUNCTION public.fleet_shift_access() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT fleet_private.shift_access_state() $$;
REVOKE ALL ON FUNCTION public.fleet_shift_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fleet_shift_access() TO authenticated;
