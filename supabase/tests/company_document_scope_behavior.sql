\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.profiles (id, full_name, email, role)
VALUES
  ('10000000-0000-0000-0000-000000000006', 'Membro isolado A', 'member-isolated-a@example.test', 'user'),
  ('10000000-0000-0000-0000-000000000007', 'Sem membership', 'no-membership@example.test', 'user'),
  ('10000000-0000-0000-0000-000000000008', 'Membership inativa', 'inactive-membership@example.test', 'user');
INSERT INTO public.company_memberships (company_id, profile_id, role, status)
VALUES
  ((SELECT id FROM public.companies WHERE slug='simplicity2take'),
   '10000000-0000-0000-0000-000000000006', 'member', 'Ativo'),
  ((SELECT id FROM public.companies WHERE slug='simplicity2take'),
   '10000000-0000-0000-0000-000000000008', 'member', 'Inativo');

INSERT INTO public.documents (id, company_id, name, driver_id) VALUES
  ('50000000-0000-0000-0000-000000000001',
   (SELECT id FROM public.companies WHERE slug='simplicity2take'),
   'Documento da Empresa A', NULL),
  ('50000000-0000-0000-0000-000000000002',
   (SELECT id FROM public.companies WHERE slug='simplicity2take'),
   'Documento Motorista A', '20000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000003',
   (SELECT id FROM public.companies WHERE slug='simplicity2take'),
   'Documento Partilhado A', NULL),
  ('50000000-0000-0000-0000-000000000004',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Documento da Empresa B', NULL),
  ('50000000-0000-0000-0000-000000000005',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Documento Motorista B', '20000000-0000-0000-0000-000000000105');

INSERT INTO public.document_viewers (document_id, driver_id, can_view) VALUES
  ('50000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001',true),
  ('50000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000105',true);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
DO $company_a_admin$
BEGIN
  IF (SELECT count(*) FROM public.documents) <> 3 THEN
    RAISE EXCEPTION 'Company A admin cannot read all documents owned by Company A';
  END IF;
  IF EXISTS (SELECT 1 FROM public.documents WHERE id IN (
    '50000000-0000-0000-0000-000000000004','50000000-0000-0000-0000-000000000005'
  )) THEN
    RAISE EXCEPTION 'Company A admin can read Company B documents';
  END IF;
  IF (SELECT count(*) FROM public.document_viewers) <> 1 THEN
    RAISE EXCEPTION 'Company A admin cannot read only its own document viewer grants';
  END IF;
END;
$company_a_admin$;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000006', false);
DO $company_a_member$
BEGIN
  IF (SELECT count(*) FROM public.documents) <> 2
     OR EXISTS (SELECT 1 FROM public.documents WHERE id='50000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'Company A member document scope mismatch: visible_count=%, private_document_visible=%, driver_id=%, is_company_member=%, is_company_admin=%',
      (SELECT count(*) FROM public.documents),
      EXISTS (SELECT 1 FROM public.documents WHERE id='50000000-0000-0000-0000-000000000002'),
      public.s2t_driver_id(),
      public.s2t_is_company_member((SELECT id FROM public.companies WHERE slug='simplicity2take')),
      public.s2t_is_company_admin((SELECT id FROM public.companies WHERE slug='simplicity2take'));
  END IF;
  IF EXISTS (SELECT 1 FROM public.document_viewers) THEN
    RAISE EXCEPTION 'Company member can inspect document viewer grants';
  END IF;
END;
$company_a_member$;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', false);
DO $driver_a$
BEGIN
  IF (SELECT count(*) FROM public.documents) <> 2
     OR EXISTS (SELECT 1 FROM public.documents WHERE id IN (
       '50000000-0000-0000-0000-000000000001',
       '50000000-0000-0000-0000-000000000004',
       '50000000-0000-0000-0000-000000000005'
     )) THEN
    RAISE EXCEPTION 'Driver access does not match own document and explicit viewer grant';
  END IF;
  IF (SELECT count(*) FROM public.document_viewers) <> 1 THEN
    RAISE EXCEPTION 'Driver cannot see only its own document viewer grant';
  END IF;
END;
$driver_a$;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', false);
DO $company_b_admin$
BEGIN
  IF (SELECT count(*) FROM public.documents) <> 2
     OR EXISTS (SELECT 1 FROM public.documents WHERE id IN (
       '50000000-0000-0000-0000-000000000001',
       '50000000-0000-0000-0000-000000000002',
       '50000000-0000-0000-0000-000000000003'
     )) THEN
    RAISE EXCEPTION 'Company B document access crossed into Company A';
  END IF;
  IF (SELECT count(*) FROM public.document_viewers) <> 1 THEN
    RAISE EXCEPTION 'Company B admin cannot read its own viewer grants';
  END IF;
END;
$company_b_admin$;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000007', false);
DO $without_membership$
BEGIN
  IF EXISTS (SELECT 1 FROM public.documents)
     OR EXISTS (SELECT 1 FROM public.document_viewers)
     OR EXISTS (SELECT 1 FROM public.drivers)
     OR EXISTS (SELECT 1 FROM public.vehicles)
     OR EXISTS (SELECT 1 FROM public.vehicle_assignments) THEN
    RAISE EXCEPTION 'A user without company membership can read company or fleet records';
  END IF;
END;
$without_membership$;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000008', false);
DO $inactive_membership$
BEGIN
  IF EXISTS (SELECT 1 FROM public.documents)
     OR EXISTS (SELECT 1 FROM public.document_viewers)
     OR EXISTS (SELECT 1 FROM public.drivers)
     OR EXISTS (SELECT 1 FROM public.vehicles)
     OR EXISTS (SELECT 1 FROM public.vehicle_assignments) THEN
    RAISE EXCEPTION 'A user with an inactive company membership can read company or fleet records';
  END IF;
END;
$inactive_membership$;

RESET ROLE;
ROLLBACK;
