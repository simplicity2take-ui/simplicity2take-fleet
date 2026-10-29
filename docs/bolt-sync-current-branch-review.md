# Bolt sync — review of current branch (29 October 2026)

Status: static review only. No Bolt request was made, no database was queried or changed, and no deployment was performed.

## Findings confirmed in the current source

1. **The endpoint paths now match the v2 prefix in the provider contract recorded in this repository.** The function uses the v2 gateway base URL and calls `/fleetIntegration/v2/getCompanies`, `getDrivers`, and `getVehicles`. Earlier notes in the test matrix saying the current code still uses incorrect v1 paths are historical and must not be read as a statement about this branch's current code.
2. **Pagination is delegated to `fetchAllBoltPages`.** Its exact request/termination behavior and tests still need to be checked against the documented v2 contract. Unit tests do not establish what the live account returns.
3. **Preview mode is not offline.** `dry_run: true` returns before any Fleet table reads/writes, but it obtains a Bolt token and calls the live Bolt endpoints. Do not use it as a no-network test.
4. **Write mode is gated, but not production-safe.** It requires `BOLT_SYNC_ALLOW_WRITES=true` and `confirm_write: true`. This guard is not a substitute for authorization, tenant isolation, or transactionality.
5. **The database apply is not atomic.** Vehicle, driver, and assignment writes are separate Supabase requests. A later failure can leave earlier changes committed. Keep writes disabled until a transactional apply path and failure-injection tests exist.
6. **Authorization and tenant scope remain blockers.** The function authorizes a single hard-coded administrator email and uses service-role queries. It assumes exactly one company is visible from Bolt but does not yet bind every Fleet lookup/write to a reviewed company ownership model.
7. **Assignment history is protected from destructive replacement in this branch,** but that does not prevent partial writes elsewhere in the sync or concurrent assignment races without database constraints/locking.
8. **Operational verification remains incomplete.** The local environment previously checked for this task did not have Deno, Supabase CLI, PostgreSQL client, or Docker available. The latest unit-test changes must not be described as passing unless a workflow run for the current commit is observed.

## Safe next work

- Reconcile older historical notes in `docs/bolt-sync-test-matrix.md` with the current source so the release checklist is not contradictory.
- Verify `fetchAllBoltPages` and its unit tests against the provider contract, including offset increments, short final page, application-level error, malformed envelope, repeated page and hard ceilings.
- Add a mocked test for the preview path proving it returns before all Fleet table queries/writes; keep provider HTTP mocked so tests never contact Bolt.
- Implement and test a transaction boundary and company-scoped authorization before enabling writes.
- Keep both the server write flag and request confirmation unset until the user separately approves a specific live operation.

## Release decision

**Not ready for production sync.** No migration, deployment, live API call, production write, or PR merge is authorized by this review.
