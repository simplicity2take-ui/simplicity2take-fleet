# Disposable Supabase validation runbook

## Purpose

Validate the draft company/fleet migrations and the Bolt-sync data model in an isolated Supabase environment before proposing any production rollout. This runbook is a plan, not evidence that validation has been run.

## Hard safety rules

- Never point this procedure at the production project `lmutpimlokagjwngqanx`.
- Do not use inactive projects `xnxlhrvokrvivvqjxyua` (FleetCheck) or `nwdmnnfbptkuimtjtrby` (GoalRadar) as test environments.
- Use a newly created disposable project or an explicitly provisioned development branch that is confirmed to be isolated from production.
- Check the provider's estimated cost first. Do not create a paid project/branch until the exact cost is disclosed and the user explicitly approves that cost.
- Do not copy production data, credentials, personal data, or provider secrets into the test environment. Use synthetic fixtures and test-only credentials.
- Do not deploy Edge Functions, call live Bolt endpoints, run syncs, or enable write gates as part of migration validation.
- Never put service-role keys, API secrets, access tokens, or database passwords in this document, commits, logs, or chat.

## Phase 0 — Environment identity

Record the following before running SQL:

- Supabase project name and project ID
- Whether the environment is a disposable project or an isolated development branch
- Confirmation that it is not production and has no production data
- Migration starting point / schema version
- Operator and date

Stop if any field cannot be confirmed. A project name alone is not proof that it is safe.

## Phase 1 — Prepare and baseline

1. Check out the PR branches under review and inspect the exact migration files:
   - `supabase/migrations/20261026190000_company_fleet_foundation.sql`
   - `supabase/migrations/20261026200000_company_memberships_and_integrity.sql`
2. Ensure the disposable database starts from a schema compatible with the migrations. Do not try to reproduce production by copying its data.
3. Run `docs/company-migration-preflight.sql` against the disposable database only.
4. Save the read-only output as a test artifact. Note missing dependencies, unexpected row counts, null values, existing constraints, and current RLS state.
5. If required tables or `public.s2t_is_admin()` are absent, stop and resolve the test baseline rather than editing production or bypassing the preflight.

## Phase 2 — Apply migrations only in the disposable environment

1. Apply the company foundation migration first.
2. Inspect its output and schema before continuing.
3. Apply the memberships/integrity migration second.
4. If either migration fails, capture the error and stop. Do not continue from a partially migrated database unless the failure/recovery path is explicitly part of the test.
5. Do not apply these migrations to production during this validation run.

## Phase 3 — Read-only postflight

Run `docs/company-migration-postflight.sql` against the same disposable database. Review every result, especially:

- Exactly one expected company row for the initial company slug
- No drivers or vehicles left without a company owner
- Assignment driver/vehicle ownership consistency
- Assignment nullability and the behavior when either foreign key is NULL
- RLS enabled where expected and constraints present

A clean postflight is necessary but not sufficient. Record results; do not label the migrations production-ready based on these queries alone.

## Phase 4 — Required behavioral tests

Use synthetic records only. Verify and record pass/fail for each:

1. Fresh schema: both migrations apply in order.
2. Repeatability: determine whether a second application is intentionally supported; do not assume idempotency.
3. Backfill: existing synthetic drivers and vehicles receive the expected company ID.
4. Tenant isolation: a member of Company A cannot read or mutate Company B's protected records.
5. Membership roles: member, company admin, and global admin have only their intended permissions.
6. Assignment insert: same-company driver and vehicle succeeds.
7. Assignment insert: cross-company driver/vehicle is rejected.
8. Assignment nulls: NULL driver and/or vehicle are rejected by constraints or trigger behavior as designed.
9. Ownership change: changing a driver's or vehicle's company cannot silently leave existing assignments cross-company.
10. RLS coverage: assignments, documents, platform history, reports, CarTrack data, and other tenant-owned tables are explicitly reviewed; do not infer coverage from RLS on `companies` alone.
11. Rollback/recovery: document the supported recovery procedure and verify it only in the disposable environment.
12. Bolt sync failure safety: simulated API, validation, and database failures cannot leave partial writes. This requires a transactional implementation and tests; the current non-atomic implementation must not be considered safe for write mode.

## Phase 5 — Evidence and decision

Attach the following to the PR before any production decision:

- Environment identity and migration baseline
- Preflight and postflight outputs
- Exact migration revisions tested
- Test matrix with pass/fail and evidence
- Any SQL errors and fixes
- Tenant/RLS review and rollback results
- Confirmation that no live provider calls and no production writes occurred

Production rollout remains blocked until tenant authorization/RLS coverage, trusted admin authorization, ownership/assignment integrity, uniqueness/concurrency protections, transactional Bolt apply with rollback tests, backup/reconciliation, and a separately approved rollout plan are complete.

## Cleanup

After evidence is captured, destroy the disposable environment using the provider's supported controls, or retain it only if explicitly approved. Verify that test-only secrets and access are revoked. Never treat an inactive pre-existing project as disposable without confirming ownership, contents, and intended use.

## Current status

**Not executed.** No disposable Supabase environment has been confirmed or created, and these migrations have not been applied as part of this runbook. This document does not certify the migrations or authorize production changes.
