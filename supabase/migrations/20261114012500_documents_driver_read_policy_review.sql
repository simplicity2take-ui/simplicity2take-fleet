-- REVIEW ONLY: do not apply without explicit approval.
-- Align documents SELECT RLS with Fleet's driver viewer rules.
-- Admin may view expired documents to replace them.
-- Vehicle documents require an active assignment, regardless of driver_id
-- or document_viewers entries.
-- CURRENT_DATE uses database timezone; verify timezone policy before rollout.
BEGIN;

DROP POLICY IF EXISTS "s2t documents select" ON public.documents;

CREATE POLICY "s2t documents select"
ON public.documents
FOR SELECT
TO authenticated
USING (
  public.s2t_is_admin()
  OR (
    (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
    AND (
      (
        vehicle_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.vehicle_assignments va
          WHERE va.vehicle_id = documents.vehicle_id
            AND va.driver_id = public.s2t_driver_id()
            AND va.active_from <= CURRENT_DATE
            AND (va.active_until IS NULL OR va.active_until >= CURRENT_DATE)
        )
      )
      OR (
        vehicle_id IS NULL
        AND (
          driver_id = public.s2t_driver_id()
          OR (
            driver_id IS NULL
            AND EXISTS (
              SELECT 1
              FROM public.document_viewers dv
              WHERE dv.document_id = documents.id
                AND dv.driver_id = public.s2t_driver_id()
                AND dv.can_view = true
            )
          )
        )
      )
    )
  )
);

COMMIT;
