# Multi-company release blockers — actionable checklist

This is a source-review checklist only. It does not authorize migration, deployment, merge, or live API access.

## P0 — Must be resolved before any external company account is enabled

- [ ] **Assignment identifiers fail closed.** Verify `vehicle_assignments.driver_id` and `vehicle_id` are both NOT NULL in the actual schema. If either can be NULL, reject NULL in a database constraint/trigger. Do not infer nullability from application types.
- [x] **Ownership changes preserve assignment integrity (PR #37).** Company ownership updates take the assignment-table mutex before row updates; transfers are rejected when a driver or vehicle has any active or historical assignment. CI covers active history, closed history, unassigned corrections, and the assignment/transfer race.
- [ ] **All tenant data is scoped.** Inventory and test vehicles, drivers, assignments, documents, document viewers, trips/activity, Uber/Bolt reports, CarTrack records, recruitment, payment/order records, audit records, exports and server functions.
- [ ] **Server-side authorization is authoritative.** No client-supplied company ID, email, or role can grant access. Edge Functions using service-role credentials must check active membership/role and tenant scope explicitly.
- [x] **Sync is atomic and retry-safe (PR #37).** Bolt vehicle/driver writes and assignment decisions run in one service-only transaction. Disposable PostgreSQL CI passes rollback, idempotent retry, active-history conflict, and concurrent duplicate-provider-identity tests at commit `7243aa02caae85e3145a89ad01c6cbc84f4daa24`. Keep live writes disabled until the migration is reviewed and applied.

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

- Ownership transfer with assignment history: guarded in PR #37; disposable PostgreSQL behavior and concurrency tests **PASS** at commit `f30e0707b744bde87c79cbf2e76ee08e5ed663b2`.
- Static review remains **BLOCKED** on production schema verification, full tenant coverage, company-admin provisioning, and deployment/API validation. Disposable PostgreSQL Bolt atomic-sync behavior and concurrency tests **PASS** at commit `7243aa02caae85e3145a89ad01c6cbc84f4daa24`.
- Hosted Supabase migration test: **NOT RUN**. Repository CI uses a disposable PostgreSQL database only.
- Production mutation/deployment: **NOT PERFORMED**.
