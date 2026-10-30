# Security patch proposal — driver identity and assignment history

**Status:** review-only draft. Not a Supabase migration; not executed.

## Proposed changes

1. Extend the existing trigger-only `s2t_guard_company_ownership_change()` to reject changes to `drivers.profile_id` unless `s2t_is_admin()` is true. Company administrators retain ordinary operational updates, but cannot bind a driver record to another person's login. The trigger covers direct SQL/API updates as well as application code.
2. Remove the assignment DELETE policy and revoke DELETE from `anon` and `authenticated`. This intentionally includes global admins through the public API. Correct assignments by setting `active_until`, then insert a new row where appropriate. Exceptional retention/deletion must be a separate audited maintenance process.

## Disposable-database validation required

### Driver profile linkage
- company_admin updates ordinary driver fields: succeeds.
- company_admin changes `profile_id`: fails with SQLSTATE `42501`.
- ordinary company member changes `profile_id`: fails.
- global admin changes `profile_id`: succeeds only through the intended authorized administrative workflow.
- global admin ownership correction remains possible.
- company_admin changes driver or vehicle `company_id`: fails.
- updates changing both `company_id` and `profile_id` still invoke the guard.

### Assignment history
- company_admin DELETE through API: denied.
- global admin DELETE through API: denied.
- anon DELETE: denied.
- authorized SELECT/INSERT/UPDATE continue under existing RLS/grants.
- closing an active assignment with `active_until` remains possible.
- inserting a replacement leaves the previous row intact and queryable.

### Gates
- Inspect existing table grants/policies, including inherited grants.
- Verify trigger function owner and SECURITY DEFINER semantics; do not broaden EXECUTE grants.
- Test with actual authenticated JWT claims and at least two companies.
- Verify cross-company driver/profile reassignment is rejected.
- Run Supabase security advisors after a real migration.
- Confirm no frontend path expects assignment DELETE.
- Only after validation, generate a migration using `supabase migration new`; do not hand-rename this draft into a migration.

## Explicitly not done
- No SQL executed; no production data or policies changed.
- No migration generated or deployed.
- No assignment history deleted or modified.
- No PR merged.


## Application integration added in PR #37

- Editing a vehicle now calls `s2t_replace_vehicle_assignments`; the browser no longer deletes/reinserts assignment rows directly.
- The vehicle action is now **Arquivar**: active assignments are closed through the RPC and the vehicle status is set to `Inativo`; the vehicle row is retained.
- The driver action is now **Desativar**: `s2t_deactivate_driver` closes active assignments and sets the driver status to `Inativo` in one transaction; the driver row and documents remain.
- Assignment replacement now rejects inactive drivers, preventing them from being newly assigned.

## Additional SQL preflight

`supabase/tests/assignment_history_guard_preflight.sql` checks, without creating fixtures, that:
- the driver trigger includes `profile_id`;
- the trigger function contains the global-admin guard;
- no authenticated/public DELETE policy or table DELETE grant remains on `vehicle_assignments`;
- both RPCs are SECURITY INVOKER and executable by authenticated but not anon.

This preflight is not a substitute for behavioral tests with two authenticated users in two companies. It has not been run because no disposable database has been provisioned.
