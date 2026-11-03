# Multi-company release blockers — actionable checklist

This is a source-review checklist only. It does not authorize migration, deployment, merge, or live API access.

## P0 — Must be resolved before any external company account is enabled

- [ ] **Assignment identifiers fail closed.** Verify `vehicle_assignments.driver_id` and `vehicle_id` are both NOT NULL in the actual schema. If either can be NULL, reject NULL in a database constraint/trigger. Do not infer nullability from application types.
- [ ] **Ownership changes preserve assignment integrity.** The current trigger only fires when `vehicle_assignments.driver_id` or `vehicle_id` changes. Add a reviewed database-enforced rule or controlled transfer workflow for updates to `drivers.company_id` and `vehicles.company_id`.
- [ ] **All tenant data is scoped.** Inventory and test vehicles, drivers, assignments, documents, document viewers, trips/activity, Uber/Bolt reports, CarTrack records, recruitment, payment/order records, audit records, exports and server functions.
- [ ] **Server-side authorization is authoritative.** No client-supplied company ID, email, or role can grant access. Edge Functions using service-role credentials must check active membership/role and tenant scope explicitly.
- [ ] **Sync is atomic and retry-safe.** Apply the normalized full payload in one transaction; test rollback, duplicate request/retry, and concurrent runs. Keep the write gate closed until tests pass.

## P1 — Must be resolved before migration review can be marked PASS

- [ ] Confirm dependencies `public.profiles`, `public.s2t_is_admin()`, `auth.uid()`, table names and ID types in a disposable local schema.
- [ ] Capture baseline row counts and ownership/null counts using synthetic fixtures.
- [ ] Verify the `simplicity2take` company slug resolves to exactly one row before backfill.
- [ ] Apply the draft migrations in order to a disposable local database and repeat the migration workflow to test idempotency.
- [ ] Test same-company assignment success, cross-company assignment rejection, NULL identifier rejection, and ownership-change rejection/transfer behavior.
- [ ] Test RLS using separate authenticated users for Company A, Company B, no membership, inactive membership and global admin; do not use service-role queries as evidence of RLS enforcement.
- [ ] Run failure injection and prove the database returns to the pre-test state.
- [ ] Record exact commands, versions and PASS/FAIL/BLOCKED evidence.

## Zero-cost execution rules

- Use local PostgreSQL/Supabase CLI only if already available; do not provision a cloud project or branch.
- Use synthetic fixtures only. Never copy production data or secrets to a local test.
- If a required dependency is unavailable locally, mark that test BLOCKED and continue with static review; do not switch to a paid service.
- Do not merge PR #32/#33, deploy functions, apply migrations to the production project, or call the live Bolt API under this checklist.

## Current assessment

- Static review: **BLOCKED** on actual schema nullability, ownership-transfer integrity, full tenant coverage, and transactional sync proof.
- Remote migration test: **NOT RUN**.
- Production mutation/deployment: **NOT PERFORMED**.
