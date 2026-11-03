# Multi-company release blockers — actionable checklist

This is a source-review checklist only. It does not authorize migration, deployment, merge, or live API access.

## P0 — Must be resolved before any external company account is enabled

- [ ] **Assignment identifiers fail closed in the target database.** PR #37 adds a migration that aborts if legacy NULL references exist, then applies NOT NULL to `driver_id` and `vehicle_id`; disposable PostgreSQL CI confirms both constraints and rejects NULL writes. Verify the target schema/data before applying. Do not infer nullability from application types.
- [x] **Ownership changes preserve assignment integrity (PR #37).** Company ownership updates take the assignment-table mutex before row updates; transfers are rejected when a driver or vehicle has any active or historical assignment. CI covers active history, closed history, unassigned corrections, and the assignment/transfer race.
- [ ] **All tenant data is scoped.** Inventory and test vehicles, drivers, assignments, documents, document viewers, trips/activity, Uber/Bolt reports, CarTrack records, recruitment, payment/order records, audit records, exports and server functions.
- [ ] **Server-side authorization is authoritative.** No client-supplied company ID, email, or role can grant access. Edge Functions using service-role credentials must check active membership/role and tenant scope explicitly.
- [x] **Fleet writes are atomic and retry-safe (PR #37).** Bolt vehicle/driver writes and assignments run in one service-only transaction. Manual vehicle details and assignment changes use one authenticated company-scoped RPC. Disposable PostgreSQL CI passes rollback, idempotent retry, active-history conflict, duplicate-provider-identity concurrency, and vehicle-create/update rollback tests at commit `d31e30560a29979baaa096eb735b2a32c663ee0c`. Keep live writes disabled until the migrations are reviewed and applied.

## P1 — Must be resolved before migration review can be marked PASS

- [ ] Confirm dependencies `public.profiles`, `public.s2t_is_admin()`, `auth.uid()`, table names and ID types in a disposable local schema.
- [ ] Capture baseline row counts and ownership/null counts using synthetic fixtures.
- [ ] Verify the `simplicity2take` company slug resolves to exactly one row before backfill.
- [x] Disposable PostgreSQL 17 CI applies and reapplies the migration set to test idempotency; the latest run passes. This does not verify the hosted target schema or data.
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
- Static review remains **BLOCKED** on target schema/data verification, full tenant coverage, company-admin provisioning, and deployment/API validation. Bolt atomic sync, manual vehicle-save rollback, assignment reference constraints, history-policy idempotency, company-document RLS, and concurrency regressions **PASS** at commit `90d4353ac5567310b3b2147b0fa3f23542a1dc53` ([push](https://github.com/simplicity2take-ui/simplicity2take-fleet/actions/runs/41684200814), [pull request](https://github.com/simplicity2take-ui/simplicity2take-fleet/actions/runs/41684214834)). Bolt/Uber type checks and 23 provider-independent tests also pass. No live provider API was called.
- Hosted Supabase migration test: **NOT RUN**. Repository CI uses a disposable PostgreSQL database only.
- Production mutation/deployment: **NOT PERFORMED**.
