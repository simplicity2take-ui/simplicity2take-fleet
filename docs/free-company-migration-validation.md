# Free validation workflow for company migrations

## Cost boundary

This workflow uses only repository files, code review, and free local tooling. It does not create Supabase projects or branches, apply migrations to any remote database, deploy functions, or call the live Bolt API.

## What can be validated for free

1. Review the draft migrations and confirm every referenced table, column, helper function, policy and trigger exists in the intended schema.
2. Run the repository's existing unit tests and CI checks on the PR branches.
3. Run SQL lint/static checks with free local tooling where available.
4. Use a disposable local PostgreSQL/Supabase stack on the developer's own machine, if Docker and the Supabase CLI are already available. Local compute and disk usage are not Supabase cloud charges.
5. Test migrations only against a fresh local disposable database populated with synthetic fixtures. Never use production credentials or real customer data.
6. Record pre/post row counts, NULL counts, assignment integrity results, policy-denial results, and rollback/rebuild results.

## Mandatory local test cases

- Fresh schema: apply the company migrations in order.
- Backfill: existing synthetic drivers and vehicles receive the expected company without changing row counts.
- Idempotency: repeat the migration procedure according to the repository's migration tooling; verify no duplicate company rows.
- Assignment integrity: same-company assignment succeeds; cross-company assignment fails.
- NULL identifiers: driver_id and vehicle_id NULL cases are rejected by NOT NULL constraints or a fail-closed trigger.
- Ownership changes: changing a driver's or vehicle's company cannot leave an existing assignment cross-company.
- Membership: users with no membership, inactive membership, Company A membership and global-admin role are tested with authenticated sessions.
- Tenant denial: Company A cannot read or mutate Company B's fleet, assignments, documents, activity, reports or CarTrack data.
- Transaction rollback: inject a failure during apply and prove all writes roll back.
- Concurrency: two simultaneous sync attempts cannot create duplicate active assignments.

## Stop conditions

- If local Docker/Supabase CLI is not available, do not silently switch to a paid cloud environment.
- If schema assumptions cannot be proven from repository migrations and fixtures, mark the case BLOCKED rather than passing it.
- Do not deploy, merge, enable write flags, or call live Bolt endpoints as part of this free workflow.
- Keep results explicit: PASS, FAIL, or BLOCKED, with the exact command and environment recorded.

## Current status

This is a test procedure, not proof that the migrations pass. No database is modified by this document.
