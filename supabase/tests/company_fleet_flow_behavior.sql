\set ON_ERROR_STOP on

INSERT INTO public.companies (id, slug, legal_name, display_name, status)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'empresa-b', 'Empresa B, Lda', 'Empresa B', 'Ativa');

INSERT INTO public.company_memberships (company_id, profile_id, role, status)
VALUES
 ((SELECT id FROM public.companies WHERE slug='simplicity2take'), '10000000-0000-0000-0000-000000000001', 'company_admin', 'Ativo'),
 ((SELECT id FROM public.companies WHERE slug='simplicity2take'), '10000000-0000-0000-0000-000000000003', 'member', 'Ativo'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '10000000-0000-0000-0000-000000000002', 'company_admin', 'Ativo');

INSERT INTO public.drivers (id, company_id, profile_id, full_name, email, phone, status) VALUES
 ('20000000-0000-0000-0000-000000000001', (SELECT id FROM public.companies WHERE slug='simplicity2take'), '10000000-0000-0000-0000-000000000004', 'Motorista A1', 'a1@example.test', '910000001', 'Ativo'),
 ('20000000-0000-0000-0000-000000000002', (SELECT id FROM public.companies WHERE slug='simplicity2take'), NULL, 'Motorista A2', 'a2@example.test', '910000002', 'Ativo'),
 ('20000000-0000-0000-0000-000000000003', (SELECT id FROM public.companies WHERE slug='simplicity2take'), NULL, 'Motorista A3', 'a3@example.test', '910000003', 'Ativo'),
 ('20000000-0000-0000-0000-000000000004', (SELECT id FROM public.companies WHERE slug='simplicity2take'), NULL, 'Motorista A4', 'a4@example.test', '910000004', 'Ativo'),
 ('20000000-0000-0000-0000-000000000005', (SELECT id FROM public.companies WHERE slug='simplicity2take'), NULL, 'Motorista A5', 'a5@example.test', '910000005', 'Ativo'),
 ('20000000-0000-0000-0000-000000000006', (SELECT id FROM public.companies WHERE slug='simplicity2take'), NULL, 'Motorista A6', 'a6@example.test', '910000006', 'Ativo'),
 ('20000000-0000-0000-0000-000000000105', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '10000000-0000-0000-0000-000000000005', 'Motorista B1', 'b1@example.test', '920000001', 'Ativo');

INSERT INTO public.vehicles (id, company_id, plate, brand, model, vehicle_year, status) VALUES
 ('30000000-0000-0000-0000-000000000001', (SELECT id FROM public.companies WHERE slug='simplicity2take'), 'AA-01-AA', 'Mercedes-Benz', 'E 300', 2023, 'Ativo'),
 ('30000000-0000-0000-0000-000000000002', (SELECT id FROM public.companies WHERE slug='simplicity2take'), 'AA-02-AA', 'Tesla', 'Model 3', 2024, 'Ativo'),
 ('30000000-0000-0000-0000-000000000003', (SELECT id FROM public.companies WHERE slug='simplicity2take'), 'AA-03-AA', 'BMW', '520d', 2022, 'Ativo'),
 ('30000000-0000-0000-0000-000000000004', (SELECT id FROM public.companies WHERE slug='simplicity2take'), 'AA-04-AA', 'Toyota', 'Corolla', 2021, 'Ativo'),
 ('30000000-0000-0000-0000-000000000005', (SELECT id FROM public.companies WHERE slug='simplicity2take'), 'AA-05-AA', 'Skoda', 'Octavia', 2020, 'Ativo'),
 ('30000000-0000-0000-0000-000000000006', (SELECT id FROM public.companies WHERE slug='simplicity2take'), 'AA-06-AA', 'Kia', 'Niro', 2022, 'Ativo'),
 ('30000000-0000-0000-0000-000000000105', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'BB-01-BB', 'Toyota', 'Prius', 2023, 'Ativo');

INSERT INTO public.vehicle_assignments (id, vehicle_id, driver_id, active_from, active_until) VALUES
 ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', current_date - 7, NULL),
 ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', current_date - 1, NULL);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);

DO $company_a_admin$
DECLARE
  affected integer;
  denied boolean;
  result jsonb;
  company_a uuid := (SELECT id FROM public.companies WHERE slug='simplicity2take');
BEGIN
  IF EXISTS (SELECT 1 FROM public.drivers WHERE id='20000000-0000-0000-0000-000000000105') THEN
    RAISE EXCEPTION 'Company A can read a Company B driver';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vehicles WHERE id='30000000-0000-0000-0000-000000000105') THEN
    RAISE EXCEPTION 'Company A can read a Company B vehicle';
  END IF;

  UPDATE public.drivers SET full_name='Motorista A1 atualizado'
  WHERE id='20000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Company A admin could not update its driver'; END IF;

  denied := false;
  BEGIN
    UPDATE public.drivers SET profile_id='10000000-0000-0000-0000-000000000003'
    WHERE id='20000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Company admin changed driver profile linkage'; END IF;

  denied := false;
  BEGIN
    INSERT INTO public.vehicle_assignments (vehicle_id, driver_id, active_from)
    VALUES ('30000000-0000-0000-0000-000000000105', '20000000-0000-0000-0000-000000000001', current_date);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-company assignment insert was accepted'; END IF;

  denied := false;
  BEGIN
    UPDATE public.vehicles SET company_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    WHERE id='30000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Company admin changed vehicle ownership'; END IF;

  -- Exercise the app's Empresa -> Viaturas -> Motoristas database path.
  INSERT INTO public.drivers (id, company_id, full_name, email, phone, status)
  VALUES ('20000000-0000-0000-0000-000000000007', company_a, 'Motorista Novo', 'novo@example.test', '910000007', 'Ativo');
  INSERT INTO public.vehicles (id, company_id, plate, brand, model, vehicle_year, status)
  VALUES ('30000000-0000-0000-0000-000000000007', company_a, 'AA-07-AA', 'Renault', 'Megane', 2024, 'Ativo');

  result := public.s2t_replace_vehicle_assignments(
    '30000000-0000-0000-0000-000000000007',
    ARRAY['20000000-0000-0000-0000-000000000007']::uuid[]
  );
  IF result->>'created_assignments' <> '1' THEN
    RAISE EXCEPTION 'New company vehicle and driver were not linked';
  END IF;

  result := public.s2t_replace_vehicle_assignments(
    '30000000-0000-0000-0000-000000000007',
    ARRAY['20000000-0000-0000-0000-000000000007']::uuid[]
  );
  IF result->>'created_assignments' <> '0' THEN
    RAISE EXCEPTION 'Repeated assignment request was not idempotent';
  END IF;

  denied := false;
  BEGIN
    UPDATE public.drivers SET status='Inativo'
    WHERE id='20000000-0000-0000-0000-000000000007';
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Direct driver status update bypassed assignment closure'; END IF;

  denied := false;
  BEGIN
    UPDATE public.vehicles SET status='Inativo'
    WHERE id='30000000-0000-0000-0000-000000000007';
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Direct vehicle status update bypassed assignment closure'; END IF;

  denied := false;
  BEGIN
    PERFORM public.s2t_replace_vehicle_assignments('30000000-0000-0000-0000-000000000007', ARRAY[]::uuid[]);
  EXCEPTION WHEN invalid_parameter_value THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Same-day history closure was not rejected'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_assignments
    WHERE vehicle_id='30000000-0000-0000-0000-000000000007'
      AND driver_id='20000000-0000-0000-0000-000000000007'
      AND active_until IS NULL
  ) THEN RAISE EXCEPTION 'Failed same-day replacement partially changed history'; END IF;

  -- Close a previous interval and create a replacement without deleting history.
  result := public.s2t_replace_vehicle_assignments('30000000-0000-0000-0000-000000000002', ARRAY[]::uuid[]);
  IF result->>'closed_assignments' <> '1' THEN RAISE EXCEPTION 'Existing assignment was not closed'; END IF;
  result := public.s2t_replace_vehicle_assignments(
    '30000000-0000-0000-0000-000000000002',
    ARRAY['20000000-0000-0000-0000-000000000002']::uuid[]
  );
  IF result->>'created_assignments' <> '1' THEN RAISE EXCEPTION 'Replacement assignment was not created'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_assignments
    WHERE id='40000000-0000-0000-0000-000000000002'
      AND active_until=current_date-1
  ) OR NOT EXISTS (
    SELECT 1 FROM public.vehicle_assignments
    WHERE vehicle_id='30000000-0000-0000-0000-000000000002'
      AND driver_id='20000000-0000-0000-0000-000000000002'
      AND active_from=current_date
      AND active_until IS NULL
  ) THEN RAISE EXCEPTION 'Assignment replacement did not preserve history'; END IF;

  result := public.s2t_deactivate_driver('20000000-0000-0000-0000-000000000004');
  IF result->>'status' <> 'Inativo' OR result->>'closed_assignments' <> '1' THEN
    RAISE EXCEPTION 'Driver deactivation did not close assignments';
  END IF;

  denied := false;
  BEGIN
    PERFORM public.s2t_replace_vehicle_assignments(
      '30000000-0000-0000-0000-000000000003',
      ARRAY['20000000-0000-0000-0000-000000000004']::uuid[]
    );
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Inactive driver was assigned to a vehicle'; END IF;

  result := public.s2t_archive_vehicle('30000000-0000-0000-0000-000000000003');
  IF result->>'status' <> 'Inativo' THEN RAISE EXCEPTION 'Vehicle archive failed'; END IF;

  denied := false;
  BEGIN
    PERFORM public.s2t_replace_vehicle_assignments(
      '30000000-0000-0000-0000-000000000003',
      ARRAY['20000000-0000-0000-0000-000000000001']::uuid[]
    );
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Assignment to an archived vehicle was accepted'; END IF;

  INSERT INTO public.vehicles (id, company_id, plate, brand, model, vehicle_year, status)
  VALUES ('30000000-0000-0000-0000-000000000008', company_a, 'AA-08-AA', 'Ford', 'Focus', 2021, 'Manutenção');
  result := public.s2t_archive_vehicle('30000000-0000-0000-0000-000000000008');
  IF result->>'status' <> 'Inativo' THEN RAISE EXCEPTION 'Maintenance vehicle could not be archived'; END IF;

  denied := false;
  BEGIN
    PERFORM public.s2t_archive_vehicle('30000000-0000-0000-0000-000000000105');
  EXCEPTION WHEN no_data_found THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Company A admin operated on a Company B vehicle'; END IF;

  denied := false;
  BEGIN
    PERFORM public.s2t_replace_vehicle_assignments('30000000-0000-0000-0000-000000000105', ARRAY[]::uuid[]);
  EXCEPTION WHEN no_data_found THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Company A admin discovered or changed a Company B vehicle through assignment RPC'; END IF;

  denied := false;
  BEGIN
    PERFORM public.s2t_deactivate_driver('20000000-0000-0000-0000-000000000105');
  EXCEPTION WHEN no_data_found THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Company A admin discovered or deactivated a Company B driver'; END IF;
END;
$company_a_admin$;

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', false);
DO $company_b_admin$
BEGIN
  IF EXISTS (SELECT 1 FROM public.drivers WHERE id='20000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Company B can read a Company A driver';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id='20000000-0000-0000-0000-000000000105') THEN
    RAISE EXCEPTION 'Company B admin cannot read its driver';
  END IF;
END;
$company_b_admin$;

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', false);
DO $company_a_member$
DECLARE
  affected integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id='30000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Company member cannot read its company vehicle';
  END IF;
  UPDATE public.drivers SET full_name='Unauthorized edit'
  WHERE id='20000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Company member updated a driver'; END IF;
END;
$company_a_member$;

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000099', false);
DO $global_admin$
DECLARE
  denied boolean := false;
  company_a uuid := (SELECT id FROM public.companies WHERE slug='simplicity2take');
  company_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
BEGIN
  UPDATE public.drivers
  SET profile_id='10000000-0000-0000-0000-000000000003'
  WHERE id='20000000-0000-0000-0000-000000000001';
  IF NOT EXISTS (
    SELECT 1 FROM public.drivers
    WHERE id='20000000-0000-0000-0000-000000000001'
      AND profile_id='10000000-0000-0000-0000-000000000003'
  ) THEN RAISE EXCEPTION 'Global admin could not correct driver profile linkage'; END IF;
  -- Restore the fixture relationship so later isolated behavior checks do not
  -- inherit this identity change.
  UPDATE public.drivers
  SET profile_id='10000000-0000-0000-0000-000000000004'
  WHERE id='20000000-0000-0000-0000-000000000001';

  -- An active assignment must not be reclassified by changing its driver's owner.
  denied := false;
  BEGIN
    UPDATE public.drivers SET company_id=company_b
    WHERE id='20000000-0000-0000-0000-000000000002';
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Global admin transferred a driver with active assignment history'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.drivers WHERE id='20000000-0000-0000-0000-000000000002' AND company_id=company_a
  ) THEN RAISE EXCEPTION 'Rejected driver ownership transfer changed company_id'; END IF;

  denied := false;
  BEGIN
    UPDATE public.vehicles SET company_id=company_b
    WHERE id='30000000-0000-0000-0000-000000000002';
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Global admin transferred a vehicle with active assignment history'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicles WHERE id='30000000-0000-0000-0000-000000000002' AND company_id=company_a
  ) THEN RAISE EXCEPTION 'Rejected vehicle ownership transfer changed company_id'; END IF;

  -- Closed history is protected too, so current ownership cannot rewrite old reports.
  denied := false;
  BEGIN
    UPDATE public.drivers SET company_id=company_b
    WHERE id='20000000-0000-0000-0000-000000000004';
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Global admin transferred a driver with closed assignment history'; END IF;

  denied := false;
  BEGIN
    UPDATE public.vehicles SET company_id=company_b
    WHERE id='30000000-0000-0000-0000-000000000004';
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Global admin transferred a vehicle with closed assignment history'; END IF;

  -- Unassigned rows may still be corrected by a global administrator.
  INSERT INTO public.drivers (id, company_id, full_name, email, phone, status)
  VALUES ('20000000-0000-0000-0000-000000000010', company_a, 'Motorista sem histórico', 'transfer@example.test', '910000010', 'Ativo');
  INSERT INTO public.vehicles (id, company_id, plate, brand, model, vehicle_year, status)
  VALUES ('30000000-0000-0000-0000-000000000010', company_a, 'AA-10-AA', 'Toyota', 'Yaris', 2025, 'Ativo');
  UPDATE public.drivers SET company_id=company_b
  WHERE id='20000000-0000-0000-0000-000000000010';
  UPDATE public.vehicles SET company_id=company_b
  WHERE id='30000000-0000-0000-0000-000000000010';
  IF NOT EXISTS (
    SELECT 1 FROM public.drivers WHERE id='20000000-0000-0000-0000-000000000010' AND company_id=company_b
  ) OR NOT EXISTS (
    SELECT 1 FROM public.vehicles WHERE id='30000000-0000-0000-0000-000000000010' AND company_id=company_b
  ) THEN RAISE EXCEPTION 'Global admin could not correct unassigned ownership'; END IF;

  BEGIN
    DELETE FROM public.vehicle_assignments
    WHERE id='40000000-0000-0000-0000-000000000002';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Global admin deleted assignment history'; END IF;

  denied := false;
  BEGIN
    DELETE FROM public.vehicles WHERE id='30000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Global admin physically deleted a vehicle'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_assignments WHERE id='40000000-0000-0000-0000-000000000002'
  ) THEN RAISE EXCEPTION 'Historical assignment row was lost'; END IF;
END;
$global_admin$;

RESET ROLE;
