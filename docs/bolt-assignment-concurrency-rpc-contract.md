# Bolt assignment concurrency — transactional RPC contract

**Status: design only.** This document does not add a migration, deploy a function, enable Bolt writes, call the live Bolt API, or change production data.

## Why the PR #34 check is not sufficient

The current Edge Function reads active assignments for a driver and vehicle, then inserts in a separate request. Two invocations can both read “no conflict” before either inserts. The PR #34 check is useful as an early, fail-closed guard, but it cannot guarantee uniqueness under concurrent requests.

The current production snapshot also contains six vehicle records with two active driver assignments each. Those records must be reviewed manually before introducing a uniqueness constraint or attempting automatic cleanup. No assignment should be closed or deleted by this work.

## Recommended first safe boundary

Implement a narrowly scoped PostgreSQL RPC for **assignment decisions only**, after the company ownership migrations have been tested in a disposable Supabase project and the final schema is known.

For the first version, prefer a conservative table lock over a clever but incomplete advisory-lock scheme:

1. Start one PostgreSQL transaction for the RPC call.
2. Verify the call is from the intended server-side role (service_role) and reject browser roles. Keep the service-role key exclusively in the Edge Function.
3. Resolve the allowed company from trusted server-side configuration/database mapping. Do not treat a company ID supplied by the browser or an untrusted payload as authorization.
4. Acquire LOCK TABLE public.vehicle_assignments IN SHARE ROW EXCLUSIVE MODE before reading active assignment rows.
5. Validate that the driver and vehicle both exist and belong to the resolved company.
6. Read all active assignments using the agreed definition:
   active_from <= current_date AND (active_until IS NULL OR active_until >= current_date).
7. If the driver has an active assignment to another vehicle, return a conflict and make no change.
8. If the vehicle has an active assignment to another driver, return a conflict and make no change.
9. If the exact driver/vehicle assignment is already active, return unchanged.
10. Otherwise insert one Bolt-sourced assignment. Never delete or silently close existing history.
11. Return a small result (created, unchanged, or conflict) only after the transaction commits.

### Why this lock

PostgreSQL's SHARE ROW EXCLUSIVE table lock conflicts with the ROW EXCLUSIVE lock acquired by ordinary INSERT/UPDATE/DELETE statements. It therefore serializes this RPC with other writers to this table, including legacy direct writes, rather than relying on every caller to remember an advisory lock. It is deliberately conservative: assignment writes will queue while the RPC holds the lock. Measure the impact before considering finer-grained locking.

The lock is transaction-scoped and must be acquired before the conflict reads. Acquiring it after reading does not close the race. The RPC must not catch a database exception and return a success-shaped result; an exception must roll back the transaction.

## Security and tenancy requirements

- Do not implement against the current production schema: the inspected production schema does not yet contain companies or company_id on drivers/vehicles.
- Apply and validate the company foundation only in a disposable project first; then implement the RPC on the same reviewed migration branch/schema.
- Use SECURITY INVOKER where possible and grant execution only to the service role needed by the Edge Function. Explicitly revoke execution from PUBLIC, anon, and authenticated.
- If a SECURITY DEFINER function is later shown to be unavoidable, stop for a separate security review: fixed empty search_path, schema-qualified objects, explicit service-role and tenant authorization, and narrowly scoped ownership/grants are mandatory.
- Service-role access bypasses ordinary RLS. The RPC must explicitly scope every read and write to the resolved company.
- Do not use a hard-coded email as the authorization model.
- Do not expose the RPC through browser clients or add service credentials to frontend code.

## Required tests in a disposable database

1. No active assignment: creates exactly one row.
2. Same active driver/vehicle pair: returns unchanged and creates no row.
3. Driver already assigned to another vehicle: conflict; no row changed.
4. Vehicle already assigned to another driver: conflict; no row changed.
5. Multiple active assignments on either side: conflict; no row changed.
6. Historical, expired assignment: does not block a new valid assignment and remains unchanged.
7. Future-dated assignment: does not count as active today and remains unchanged.
8. Cross-company driver/vehicle pair: rejected.
9. Unauthenticated, anon and authenticated browser callers: rejected.
10. Service-role caller with an invalid company mapping: rejected.
11. Two concurrent calls assigning the same vehicle to different drivers: at most one creates; the other observes conflict after waiting.
12. Two concurrent calls assigning one driver to different vehicles: at most one creates; the other observes conflict after waiting.
13. A direct INSERT racing with the RPC: serialized by the table lock; no duplicate active assignment is created by the tested write paths.
14. Injected insert failure: no partial assignment write remains after rollback.

The concurrency tests must use two independent database sessions/connections and synchronize the start of both transactions. Sequential calls do not prove concurrency safety.

## Important limitations

- This RPC protects assignment decisions only. It does not make the complete Bolt import (vehicle upserts, driver upserts, assignments and audit outcome) atomic. A separate import-level transaction/idempotency design remains necessary.
- The current production dataset contains six known active-assignment conflicts. The RPC must report these rather than auto-resolving them.
- The table lock serializes all assignment-table writers and may affect manual Fleet edits. Keep it behind a feature/write gate until performance and operational behavior are tested.
- The existing Edge Function's read-before-insert checks should remain as early validation, but must not be described as the concurrency guarantee.
- Do not remove the existing write gate (BOLT_SYNC_ALLOW_WRITES plus per-request confirmation) until the RPC, integration tests, tenant isolation and release gates are complete.

## Exit criteria

- [ ] Exact target schema and migration order confirmed in an isolated Supabase project.
- [ ] Existing six conflicts reviewed; no automatic repair.
- [ ] RPC security grants and tenant resolution independently reviewed.
- [ ] All functional, cross-tenant, rollback and two-session concurrency tests pass.
- [ ] Edge Function calls the RPC instead of inserting assignments directly.
- [ ] Full import partial-failure/idempotency design is completed separately.
- [ ] Explicit approval obtained before any production migration, deployment or live Bolt write.
