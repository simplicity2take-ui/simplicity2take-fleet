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
