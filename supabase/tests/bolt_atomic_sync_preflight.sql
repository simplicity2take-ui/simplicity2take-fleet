\set ON_ERROR_STOP on

DO $test$
DECLARE
  v_function oid;
  v_definition text;
BEGIN
  SELECT to_regprocedure('public.s2t_apply_bolt_fleet_sync(uuid,jsonb,jsonb,timestamptz)')::oid
    INTO v_function;

  IF v_function IS NULL
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_function)
     OR coalesce((SELECT array_to_string(proconfig, ',') FROM pg_proc WHERE oid=v_function),'') NOT LIKE '%search_path=%'
     OR NOT has_function_privilege('service_role', v_function, 'EXECUTE')
     OR has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR has_function_privilege('anon', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: atomic Bolt sync RPC is missing or has unsafe execution grants';
  END IF;

  SELECT pg_get_functiondef(v_function) INTO v_definition;
  IF position('share row exclusive' in lower(v_definition)) = 0
     OR position('s2t_bolt_assign_vehicle' in v_definition) = 0
     OR position('company_id' in v_definition) = 0 THEN
    RAISE EXCEPTION 'FAIL: atomic Bolt sync RPC lacks the assignment mutex, company scope, or transactional assignment decision';
  END IF;

  RAISE NOTICE 'PASS: atomic Bolt sync RPC is service-only, company-scoped and shares the assignment mutex';
END;
$test$;
