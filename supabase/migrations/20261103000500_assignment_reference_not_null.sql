-- Assignment rows always require both fleet references.
-- Abort before changing schema if legacy incomplete rows need an explicit review.
DO $assignment_reference_precondition$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.vehicle_assignments
    WHERE driver_id IS NULL OR vehicle_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot require vehicle assignment references: review and reconcile existing NULL driver_id/vehicle_id rows first'
      USING ERRCODE = '23502';
  END IF;
END;
$assignment_reference_precondition$;

ALTER TABLE public.vehicle_assignments
  ALTER COLUMN driver_id SET NOT NULL,
  ALTER COLUMN vehicle_id SET NOT NULL;
