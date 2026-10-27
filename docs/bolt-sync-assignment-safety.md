# Bolt sync assignment safety — validation plan

Status: draft implementation on `fix/bolt-sync-preserve-assignments`. No production function has been deployed and no production data has been changed.

## Expected behavior

- A driver with exactly one active assignment to the same vehicle reported by Bolt remains unchanged.
- A driver with any active assignment to a different vehicle is flagged as a conflict; the existing assignment and history are preserved.
- A driver with multiple active assignments is flagged as a conflict, even if they point to the same vehicle.
- A driver with no active assignment receives a new assignment only when Bolt reports a vehicle that can be matched to a Fleet vehicle.
- The sync response reports `assignments.created` and `assignments.conflictsRequiringReview`.

## Required checks before deployment

- [ ] Run the repository's Deno/type-check workflow for `supabase/functions/bolt-sync/index.ts`.
- [ ] Test no active assignment: one new assignment is created.
- [ ] Test exactly one matching active assignment: no write to `vehicle_assignments`.
- [ ] Test one active assignment to a different vehicle: no delete/insert; conflict count increases.
- [ ] Test multiple active assignments: no delete/insert; conflict count increases.
- [ ] Test Bolt driver with no matched active vehicle: existing assignment remains untouched.
- [ ] Confirm the frontend can display or otherwise surface the returned conflict count.
- [ ] Verify external Bolt response mapping and pagination using an approved non-production test account or a safe read-only request.
- [ ] Review driver/vehicle identity matching and tenant/company scope before deployment.

## Limitations

This change deliberately does not automatically close an old assignment or transfer a driver to another vehicle. Conflicts require a human-reviewed resolution flow. This avoids silent history loss but means a Bolt-reported vehicle change will not automatically become the Fleet active assignment.

A passing static inspection is not a substitute for CI tests. Do not deploy or run a real sync until the checks above have been completed and reviewed.
