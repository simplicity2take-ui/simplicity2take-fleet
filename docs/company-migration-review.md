# Company migration review — findings and release blockers

Status: static source review only. No migration has been applied and no database was modified.

Reviewed draft migrations:
- `20261026190000_company_fleet_foundation.sql`
- `20261026200000_company_memberships_and_integrity.sql`

## Findings

### Blocker 1 — ownership changes can invalidate existing assignments

The assignment trigger checks company IDs when a row in `vehicle_assignments` is inserted or when its `driver_id`/`vehicle_id` changes. It does not run when `drivers.company_id` or `vehicles.company_id` changes. Changing the company of an already-assigned driver or vehicle could therefore leave a cross-company assignment behind.

Required before multi-company use:
- Add a safe ownership-transfer workflow that closes/reconciles affected assignments before changing ownership, or a reviewed database-enforced rule that validates affected assignments.
- Test company changes for drivers and vehicles with active and historical assignments.
- Define historical ownership semantics explicitly; joining old records to current ownership can misrepresent historical reports.

### Blocker 2 — NULL assignment IDs need schema-level protection

The current `s2t_guard_assignment_company()` trigger rejects a NULL `driver_id` or `vehicle_id` with SQLSTATE `23502`. This is an improvement over the earlier draft behavior, but a trigger is not a substitute for verifying schema constraints and foreign keys.

Required before testing/release:
- Verify the actual nullability and foreign keys in the isolated test schema.
- Prefer reviewed `NOT NULL` constraints as well as foreign keys, after checking existing data and the application’s legitimate assignment lifecycle.
- Test NULL driver and NULL vehicle attempts and confirm they fail without leaving partial changes.

### Blocker 3 — membership is not a complete authorization model

The migration permits a profile to select its own membership rows; global administrators can manage membership records. It does not yet provide a company-admin invitation/provisioning workflow. The `company_admin` role must not be assumed to grant write access merely because it exists.

Required before external-company onboarding:
- Define an authorized invitation/provisioning workflow and prevent self-assignment to a company.
- Test inactive memberships, users with no membership, multiple memberships, and global-admin behavior using authenticated sessions.
- Implement explicit policies and server-side checks for each permitted company-admin action.

### Blocker 4 — tenant RLS coverage is incomplete by design

The foundation adds `company_id` only to `drivers` and `vehicles`. The membership migration adds membership policies and an assignment-integrity trigger, but does not scope assignments, documents, document viewers, trip/activity history, platform reports, or CarTrack tables by company.

Required before external-company onboarding:
- Implement and test company-scoped access for every table and server-side function that can expose company data.
- Include unmatched historical platform rows and document preview/download authorization in the policy design.
- Explicitly authorize and scope service-role Edge Functions; RLS does not constrain service-role access.

### Blocker 5 — foundation backfill needs explicit preconditions and assertions

The first migration backfills every NULL `company_id` to the Simplicity2Take company and then sets the column NOT NULL. The insert is idempotent by slug, but the migration does not explicitly assert that the company lookup returned exactly one row or report pre-existing ownership anomalies.

Required before applying in an isolated environment:
- Verify the `simplicity2take` slug resolves to exactly one company.
- Record baseline row counts and NULL/non-NULL ownership counts.
- Verify existing assignments pair drivers and vehicles from the intended company before enabling the guard.
- Run the migration twice to verify idempotency and compare row counts.
- Exercise rollback only in a disposable database; do not automatically drop ownership data after it has been used.

## Test matrix required in a disposable local database

1. Fresh schema: apply both migrations in order.
2. Existing-data fixture: backfill existing drivers/vehicles without changing row counts.
3. Re-run/idempotency: no duplicate company or membership rows.
4. Same-company assignment: succeeds.
5. Cross-company assignment insert/update: rejected.
6. NULL assignment IDs: rejected by the trigger and/or NOT NULL constraints.
7. Ownership change with active assignment: rejected or handled by an explicit transfer workflow.
8. Membership access: Company A member cannot read Company B data.
9. RLS: test with authenticated sessions, not only postgres/service-role SQL.
10. Existing driver/admin behavior: no unintended regression in driver self-access, documents, assignments, or reports.
11. Tenant coverage: negative tests for documents, trip history, activity, Uber reports, and CarTrack records.
12. Failure/rollback: an injected migration/test failure leaves the disposable environment recoverable.

## Release decision

Do not merge these migrations into the release path, apply them to production, or enable external-company accounts until the blockers above are resolved and isolated test evidence is recorded. This review does not authorize production changes.
