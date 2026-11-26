-- REVIEW ONLY: do not apply without explicit approval.
-- Status verified read-only on 2026-11-15: the currently deployed documents
-- SELECT policy has no expiry filter and can expose expired document metadata
-- through the Supabase Data API even though document-access denies file bytes.
--
-- This candidate policy aligns metadata access with document-access:
--   * Admins retain access to expired documents for renewal.
--   * Drivers must never SELECT documents whose expiry_date is before today
--     in Europe/Lisbon (the same calendar timezone as document-access).
--   * Drivers must have an Ativo record, in addition to an active profile.
--   * Personal documents must belong to the current driver.
--   * Vehicle documents need an active assignment to the specific vehicle.
--   * Company documents require an explicit active document_viewers grant.
--   * Malformed rows with both vehicle_id and driver_id set do not become
--     visible to drivers.
--
-- Safe review artifact only: this SQL has NOT been applied to production.
-- Validate in a disposable environment and obtain approval before rollout.
BEGIN;

DROP POLICY IF EXISTS "s2t documents select" ON public.documents;
DROP POLICY IF EXISTS "s2t_documents_admin_or_authorized_driver" ON public.documents;
DROP POLICY IF EXISTS "s2t document read boundary" ON public.documents;

-- Supply a SELECT grant on schemas that have no other permissive reader.
CREATE POLICY "s2t documents select"
ON public.documents
FOR SELECT
TO authenticated
USING (public.s2t_is_admin() OR public.s2t_driver_id() IS NOT NULL);

-- Every authenticated SELECT must also pass this restriction, including
-- reads granted by other permissive SELECT or ALL policies.
CREATE POLICY "s2t document read boundary"
ON public.documents AS RESTRICTIVE
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin' AND p.status = 'Ativo'
  )
  OR (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'driver' AND p.status = 'Ativo'
    )
    AND (expiry_date IS NULL OR expiry_date >= (now() AT TIME ZONE 'Europe/Lisbon')::date)
    AND EXISTS (
      SELECT 1 FROM public.drivers active_driver
      WHERE active_driver.id = public.s2t_driver_id()
        AND active_driver.status = 'Ativo'
    )
    AND (
      (
        driver_id IS NOT NULL
        AND vehicle_id IS NULL
        AND driver_id = public.s2t_driver_id()
      )
      OR (
        vehicle_id IS NOT NULL
        AND driver_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.vehicle_assignments va
          WHERE va.vehicle_id = documents.vehicle_id
            AND va.driver_id = public.s2t_driver_id()
            AND va.active_from <= (now() AT TIME ZONE 'Europe/Lisbon')::date
            AND (va.active_until IS NULL OR va.active_until >= (now() AT TIME ZONE 'Europe/Lisbon')::date)
        )
      )
      OR (
        vehicle_id IS NULL
        AND driver_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.document_viewers dv
          WHERE dv.document_id = documents.id
            AND dv.driver_id = public.s2t_driver_id()
            AND dv.can_view IS TRUE
        )
      )
    )
  )
);

COMMIT;
