# Company migration review — findings and release blockers

Status: static source review only. No migration has been applied and no database was modified.

Reviewed draft migrations:
- `20261026190000_company_fleet_foundation.sql`
- `20261026200000_company_memberships_and_integrity.sql`

## Findings

### Blocker 1 — company ownership changes are not guarded against existing assignments

The assignment trigger checks the company IDs when a row in `vehicle_assignments` is inserted or when its `driver_id`/`vehicle_id` changes. It does not run when `drivers.company_id` or `vehicles.company_id` changes. After multiple companies exist, changing the company of an already-assigned driver or vehicle could leave a cross-company assignment behind.

Required before multi-company use:
- Add a safe ownership-transfer workflow that closes/reconciles active assignments before changing ownership, or a deferred integrity constraint/trigger that validates affected assignments.
- Test company changes on drivers and vehicles with active and historical assignments.
- Preserve historical ownership semantics explicitly; a simple current-company join may misrepresent historical reports.

### Blocker 2 — NULL assignment IDs are allowed through the guard

`s2t_guard_assignment_company()` returns `NEW` when either `driver_id` or `vehicle_id` is NULL. This is only safe if the deployed schema independently enforces both columns as NOT NULL. The migration itself does not establish that precondition.

Required before testing/release:
- Verify the deployed column nullability and foreign keys in the isolated test schema.
- If either column is nullable, fail closed in the trigger or add a reviewed NOT NULL constraint after checking existing data.
- Test NULL driver and NULL vehicle attempts.

### Blocker 3 — company membership is not yet a complete authorization model

The migration allows a profile to select its own membership rows, while global administrators can manage memberships. It intentionally does not let company administrators create or revoke memberships. This is acceptable as a limited first stage, but not sufficient to onboard external company administrators.

Required before external-company onboarding:
- Define an authorized invitation/provisioning workflow and prevent self-assignment to a company.
- Test inactive memberships, users with no membership, multiple memberships, and global-admin behavior using real authenticated sessions.
- Do not treat the `company_admin` role as granting write access until explicit policies and server-side checks are implemented.

### Blocker 4 — tenant RLS coverage is incomplete by design

The foundation adds `company_id` only to `drivers` and `vehicles`. The membership migration adds membership policies and an assignment integrity trigger, but does not scope assignments, documents, document viewers, trip/activity history, platform reports, or CarTrack tables by company.

Required before external-company onboarding:
- Implement and test company-scoped access for every table and server-side function that can expose company data.
- Include unmatched historical platform rows and document preview/download authorization in the policy design.
- Keep service-role Edge Functions explicitly authorized; RLS does not constrain service-role access.

### Blocker 5 — foundation backfill needs explicit preconditions and assertions

The first migration backfills every NULL `company_id` to the Simplicity2Take company and then sets the column NOT NULL. The insert is idempotent by slug, but the migration does not explicitly assert that the company lookup returned exactly one row or report pre-existing company ownership anomalies.

Required before applying in an isolated environment:
- Verify the slug resolves to exactly one company.
- Record baseline row counts and counts of NULL/non-NULL ownership values.
- Verify all current assignments pair a driver and vehicle belonging to the intended company before enabling the guard.
- Run the migration twice to verify idempotency and compare row counts.
- Exercise rollback only in a disposable database; do not automatically drop ownership data after it has been used.

## Test matrix required in a disposable Supabase project

1. Fresh schema: apply both migrations in order.
2. Existing-data fixture: backfill all existing drivers/vehicles without changing row counts.
3. Re-run/idempotency: no duplicate company or membership rows.
4. Same-company assignment: succeeds.
5. Cross-company assignment insert/update: rejected.
6. NULL assignment IDs: rejected or proven impossible by NOT NULL constraints.
7. Ownership change with active assignment: rejected or handled by an explicit transfer workflow.
8. Membership access: Company A member cannot read Company B company data.
9. RLS: test with authenticated sessions, not only postgres/service-role SQL.
10. Existing driver/admin behavior: no unintended regression in driver self-access, documents, assignments, or reports.
11. Tenant coverage: negative tests for documents, trip history, activity, Uber reports, and CarTrack records.
12. Failure/rollback: an injected migration/test failure leaves the disposable environment recoverable.

## Release decision

Do not merge these migrations into the release path, apply them to production, or enable external-company accounts until the blockers above are resolved and the isolated test evidence is recorded. This review does not authorize production changes.
