# Bolt sync assignment safety — validation plan

Status: draft implementation on `fix/bolt-sync-preserve-assignments`. No production function has been deployed and no production data has been changed.

## Expected behavior

- A driver with exactly one active assignment to the same vehicle reported by Bolt remains unchanged.
- A driver with any active assignment to a different vehicle is flagged as a conflict; the existing assignment and history are preserved.
- A driver with multiple active assignments is flagged as a conflict, even if they point to the same vehicle.
- A driver with no active assignment receives a new assignment only when Bolt reports a vehicle that can be matched to a Fleet vehicle.
- The sync response reports `assignments.created` and `assignments.conflictsRequiringReview`.
- Duplicate Bolt driver/vehicle identities in the received response abort the sync before database writes.

## Validation status

- [x] Added a GitHub Actions workflow to run `deno check supabase/functions/bolt-sync/index.ts`.
- [ ] Confirm that the new workflow has actually run and passed. A workflow file being committed is not proof of a successful check.
- [ ] Test no active assignment: one new assignment is created.
- [ ] Test exactly one matching active assignment: no write to `vehicle_assignments`.
- [ ] Test one active assignment to a different vehicle: no delete/insert; conflict count increases.
- [ ] Test multiple active assignments: no delete/insert; conflict count increases.
- [ ] Test Bolt driver with no matched active vehicle: existing assignment remains untouched.
- [ ] Confirm the frontend can display or otherwise surface the returned conflict count.
- [ ] Verify the external Bolt response mapping and pagination with the account's own API documentation or an approved read-only/non-production request.
- [ ] Review driver/vehicle identity matching and tenant/company scope before deployment.

## API contract and pagination warning

The public Bolt developer documentation found during research does not document the private Fleet Integration endpoints used by this function. The current implementation tries a few possible request shapes (`pager`, `page`, and an empty body), but that is not proof of the correct pagination contract and does not implement a page-by-page loop. It may therefore import only a partial fleet if the API paginates results.

Do not guess at the pagination schema or treat an HTTP 200 response as proof that all records were returned. Confirm the exact request fields, response envelope, total/has-more indicator, and maximum page size from the authenticated Fleet API documentation before implementing pagination or running a real sync.

## Limitations

This change deliberately does not automatically close an old assignment or transfer a driver to another vehicle. Conflicts require a human-reviewed resolution flow. This avoids silent history loss but means a Bolt-reported vehicle change will not automatically become the Fleet active assignment.

The sync currently uses a hard-coded administrator email and matches records globally rather than by company/tenant. Those restrictions must be reviewed as part of the multi-company work before deployment.

A passing type check is not a substitute for behavioral tests. Do not deploy or run a real sync until the checks above have been completed and reviewed.
