# Bolt sync: pre-deployment gates

This checklist is a review gate, not deployment authorization. The Bolt sync function must remain undeployed until each item is verified and explicitly approved.

## Blocking requirements

- [ ] Replace the hard-coded administrator email check with a trusted, server-verified authorization model (for example, a controlled role or company membership). Do not trust client-supplied role claims.
- [ ] Establish and test tenant scoping for every vehicle, driver, assignment, document, trip/activity, and report read/write touched by the sync. Service-role access bypasses ordinary RLS policies, so the function must enforce company scope itself.
- [ ] Confirm the actual Bolt Fleet Integration pagination contract against authorized provider documentation or a non-production fixture. Do not treat a successful HTTP response alone as proof that all records were returned.
- [ ] Move all Fleet writes into a single database transaction, preferably a narrowly scoped RPC that validates company scope and applies vehicles, drivers, assignments, and sync metadata atomically.
- [ ] Add an idempotency key for each sync attempt and test safe retry behavior after timeout, network failure, and transaction rollback.
- [ ] Preserve assignment history; test zero, one matching, one conflicting, and multiple active assignments, including concurrent sync attempts.
- [ ] Validate the complete payload and cross-record identity constraints before any writes. Ensure uniqueness is enforced in the database where applicable, not only in application code.
- [ ] Review the `dry_run` contract. Current behavior still requests a Bolt token and calls Bolt endpoints; it avoids Fleet-table reads/writes but is not an offline simulation. Communicate this clearly and require explicit authorization for live provider calls.
- [ ] Run the migration preflight and postflight checks on a disposable, isolated Supabase test project. Never use production or unrelated inactive projects as a test environment.
- [ ] Run automated tests, type checks, migration tests, rollback tests, concurrency tests, and a final code review. Record the exact successful CI run before requesting release approval.

## Current safeguards to retain

- The server-side write flag and per-request `confirm_write: true` must both be required for write mode.
- Keep write mode disabled by default.
- Reject malformed provider envelopes, duplicate external identities, missing identities, repeated pagination pages, and pages larger than the requested limit.
- Do not delete existing assignment rows to reconcile a mismatch. Report conflicts for manual review.
- Do not log or return raw provider/database exceptions or credentials.

## Release checklist

A reviewer should confirm all blocking requirements are complete, the target environment and migration costs are understood, the rollback plan is tested, and the operator has explicitly approved the exact deployment and live-sync actions. Approval of this document alone does not authorize those actions.
