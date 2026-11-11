-- Synthetic fixtures only; run after platform-driver-identity.sql.
BEGIN;
DO $test$
DECLARE a uuid; b uuid; got uuid;
BEGIN
 INSERT INTO public.drivers(full_name,email,phone,status) VALUES('Teste Identidade Único','identity-test-a@example.invalid','+351900000001','Ativo') RETURNING id INTO a;
 INSERT INTO public.drivers(full_name,email,phone,status) VALUES('Teste Identidade Único','identity-test-b@example.invalid','+351900000002','Ativo') RETURNING id INTO b;
 got:=public.fleet_resolve_driver_identity('uber','test-uuid-a','Nome diferente','identity-test-a@example.invalid',null);
 IF got IS DISTINCT FROM a THEN RAISE EXCEPTION 'email match failed'; END IF;
 got:=public.fleet_resolve_driver_identity('bolt','test-uuid-a','Nome diferente','outro@example.invalid','900 000 001');
 IF got IS DISTINCT FROM a THEN RAISE EXCEPTION 'phone match failed'; END IF;
 got:=public.fleet_resolve_driver_identity('bolt','test-uuid-a','Nome diferente',null,'00351 900000001');
 IF got IS DISTINCT FROM a THEN RAISE EXCEPTION 'international phone failed'; END IF;
 BEGIN
   PERFORM public.fleet_resolve_driver_identity('uber','test-uuid-a','Teste Identidade Único',null,null);
   RAISE EXCEPTION 'ambiguous accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Ambiguous driver name; phone or email required' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.fleet_resolve_driver_identity('uber','test-uuid-a',null,'identity-test-a@example.invalid','900000002');
   RAISE EXCEPTION 'conflict accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Conflicting driver contacts; review required' THEN RAISE; END IF; END;
 UPDATE drivers SET full_name='Teste Nome Único' WHERE id=a;
 got:=public.fleet_resolve_driver_identity('uber','test-uuid-a','teste nome unico',null,null);
 IF got IS DISTINCT FROM a THEN RAISE EXCEPTION 'unique name failed'; END IF;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM public.sync_uber_driver_status(jsonb_build_array(jsonb_build_object('uber_driver_uuid','test-uuid-a','status','ACTIVE','full_name','Nome Uber Diferente','email','identity-test-a@example.invalid','phone','+351900000001')));
 IF (SELECT full_name FROM drivers WHERE id=a)<>'Teste Nome Único' THEN RAISE EXCEPTION 'Fleet name replaced'; END IF;
 PERFORM public.sync_bolt_fleet(jsonb_build_array(jsonb_build_object('bolt_driver_uuid','test-bolt-a','full_name','Nome Bolt Diferente','email','different@example.invalid','phone','900000001')),'[]','[]');
 IF NOT EXISTS(SELECT 1 FROM drivers WHERE id=a AND uber_driver_uuid='test-uuid-a' AND bolt_driver_uuid='test-bolt-a' AND full_name='Teste Nome Único')
 THEN RAISE EXCEPTION 'cross-platform association failed'; END IF;
END $test$;

ROLLBACK;
