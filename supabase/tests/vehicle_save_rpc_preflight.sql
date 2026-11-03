\set ON_ERROR_STOP on

DO $test$
DECLARE
  v_function oid;
  v_definition text;
  v_config text[];
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid), p.proconfig
    INTO v_function, v_definition, v_config
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 's2t_save_vehicle_with_assignments'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_vehicle_id uuid, p_company_id uuid, p_plate text, p_brand text, p_model text, p_vehicle_year integer, p_vin text, p_status text, p_driver_ids uuid[]';

  IF v_function IS NULL
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_function)
     OR NOT EXISTS (
       SELECT 1 FROM unnest(coalesce(v_config, array[]::text[])) setting
       WHERE setting LIKE 'search_path=%'
         AND regexp_replace(setting, '^search_path=', '') IN ('', '""')
     )
     OR NOT has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR has_function_privilege('anon', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: vehicle save RPC is missing or has unsafe execution grants';
  END IF;

  IF v_definition NOT ILIKE '%auth.uid() is null%'
     OR v_definition NOT ILIKE '%s2t_is_admin()%'
     OR v_definition NOT ILIKE '%s2t_is_company_admin(v_company_id)%'
     OR v_definition NOT ILIKE '%share row exclusive%'
     OR v_definition NOT ILIKE '%s2t_replace_vehicle_assignments%'
     OR v_definition ILIKE '%company_id = p_company_id%' THEN
    RAISE EXCEPTION 'FAIL: vehicle save RPC is missing session, company, or transaction guards';
  END IF;

  RAISE NOTICE 'PASS: vehicle save RPC is authenticated, company-scoped and transactional';
END;
$test$;
