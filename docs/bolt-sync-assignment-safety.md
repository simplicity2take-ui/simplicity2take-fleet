# Bolt sync assignment safety — validation plan

Status: draft implementation on `fix/bolt-sync-preserve-assignments`. No production function has been deployed and no production data has been changed.

## Expected assignment behavior

- A driver with exactly one active assignment to the same vehicle reported by Bolt remains unchanged.
- A driver with any active assignment to a different vehicle is flagged as a conflict; the existing assignment and history are preserved.
- A driver with multiple active assignments is flagged as a conflict, even if they point to the same vehicle.
- A driver with no active assignment receives a new assignment only when Bolt reports a vehicle that can be matched to a Fleet vehicle.
- The sync response reports `assignments.created` and `assignments.conflictsRequiringReview`.
- Duplicate Bolt driver/vehicle identities in the received response abort the sync before database writes.

## Validation status

- [x] Added a GitHub Actions workflow to run `deno check supabase/functions/bolt-sync/index.ts`.
- [x] Deno type-check and unit tests passed on commit `ee8cbccd40062f5528d83f166c1d2e6b94d83b92` (workflow run 40586829378).
- [x] Code review confirms the frontend toast displays new assignment count and warns about conflicts. This is not a browser/UI test.
- [ ] Test no active assignment: one new assignment is created.
- [ ] Test exactly one matching active assignment: no write to `vehicle_assignments`.
- [ ] Test one active assignment to a different vehicle: no delete/insert; conflict count increases.
- [ ] Test multiple active assignments: no delete/insert; conflict count increases.
- [ ] Test Bolt driver with no matched active vehicle: existing assignment remains untouched.
- [ ] Verify API response mapping and pagination using the account's authenticated API documentation or an approved read-only/non-production request.
- [x] Added unit tests for duplicate fallback email, phone and registration identities, including cases where the records have different UUIDs.
- [ ] Review driver/vehicle identity matching and tenant/company scope before deployment.

## Newly identified risk: partial writes

The current function validates duplicate identities before writes, which is good, but then writes vehicles and drivers sequentially. If a later upsert fails, earlier writes may already have committed. This function does not wrap the full sync in a database transaction. Therefore, an HTTP error response does not necessarily mean that nothing changed.

Before running a real sync, either move the write phase behind a transactional database RPC/staging-and-commit design, or explicitly design and test safe idempotent recovery after partial completion. Do not claim all-or-nothing behavior until this is implemented and tested.

## API contract and pagination warning

The public Bolt developer documentation found during research does not document the private Fleet Integration endpoints used by this function. The current implementation tries a few possible request shapes (`pager`, `page`, and an empty body), but that is not proof of the correct pagination contract and does not implement a page-by-page loop. It may therefore import only a partial fleet if the API paginates results.

Do not guess at the pagination schema or treat an HTTP 200 response as proof that all records were returned. Confirm the exact request fields, response envelope, total/has-more indicator, and maximum page size from the authenticated Fleet API documentation before implementing pagination or running a real sync.

## Authorization and company isolation

The current sync uses a hard-coded administrator email and queries drivers/vehicles globally without company scope. Because it uses the Supabase service-role key, row-level security does not automatically protect these operations. Do not deploy this function for multi-company use until the authorization and tenant scope are derived from trusted server-side membership and all reads/writes are company-scoped.

## Limitations

This change deliberately does not automatically close an old assignment or transfer a driver to another vehicle. Conflicts require a human-reviewed resolution flow. This avoids silent history loss but means a Bolt-reported vehicle change will not automatically become the Fleet active assignment.

A passing type check is not a substitute for behavioral tests. Do not deploy or run a real sync until the checks above have been completed and reviewed.
