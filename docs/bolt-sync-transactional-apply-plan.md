# Bolt Sync — Transactional Apply Plan

## Status

Design only. This document does not deploy code, change database schema, enable writes, or call the live Bolt API.

## Why an atomic apply is required

The current Edge Function performs separate vehicle, driver, and assignment mutations. If a later mutation fails, earlier mutations may already be committed. A successful dry-run validates the external payload but does not prove that database writes will be atomic or safe.

## Findings from the draft company migrations

Static review of PR #32 found these draft files:

- `supabase/migrations/20261026190000_company_fleet_foundation.sql`
- `supabase/migrations/20261026200000_company_memberships_and_integrity.sql`

They are not applied migrations and must not be treated as production schema.

The first migration adds `company_id` to `vehicles` and `drivers`, backfills existing rows to the `simplicity2take` company, and makes both columns NOT NULL. The second adds `company_memberships` and an assignment trigger that rejects a driver/vehicle pair when their company IDs differ. However, the migration's own comments and review identify that tenant RLS remains incomplete.

Before the Bolt RPC can be implemented, the company foundation needs to be validated in a disposable Supabase project. In particular:

- Confirm that the `s2t_is_admin()` and `profiles` dependencies exist and have the expected security behavior.
- Test the backfill and idempotency with representative existing data and baseline row counts.
- The assignment guard currently permits a row when either assignment ID is NULL; verify both columns are independently NOT NULL or change the guard to fail closed.
- The guard does not protect against changing `drivers.company_id` or `vehicles.company_id` while assignments already exist.
- The draft adds ownership only to drivers and vehicles; assignments, documents, platform history, reports, and CarTrack data still need their own tenant access rules before external companies are enabled.
- Do not assume that a company membership row alone authorizes write operations. The role and server-side authorization rules must be explicit.

## Required architecture before enabling writes

1. **Fetch and validate outside the write transaction**
   - Authenticate the caller and authorize them through a trusted role/membership source, not a hard-coded email.
   - Resolve exactly one explicitly mapped company/tenant.
   - Fetch every Bolt page and validate response envelopes, pagination completion, required identifiers, and duplicate identities.
   - Build a normalized, bounded import payload. Do not write partial pages.

2. **Apply through one database transaction**
   - Introduce a reviewed PostgreSQL function/RPC that accepts the complete normalized import payload and the resolved company scope.
   - Validate the company scope again inside the transaction.
   - Upsert all vehicles and drivers and reconcile assignments in the same transaction.
   - Any failed validation or SQL operation must roll back the entire import.
   - Return counts and conflict identifiers only after commit; never report success before the transaction commits.
   - Do not implement the RPC until the company migrations and table constraints are tested and the ownership model is settled.

3. **Tenant isolation**
   - Every vehicle, driver, and assignment must be associated with a company/tenant using the approved schema.
   - Every lookup and mutation must be scoped to that tenant; global matching by plate, email, phone, or external UUID is not sufficient.
   - Enforce authorization in trusted server/database code and maintain appropriate RLS policies. Do not rely on client-supplied company IDs.
   - Service-role Edge Function queries must perform their own authorization checks; RLS does not automatically constrain service-role operations.

4. **Identity and assignment concurrency**
   - Review and add tenant-scoped unique constraints for external Bolt IDs and normalized fallback identifiers where business rules permit.
   - Add a database-enforced invariant preventing more than one active vehicle assignment per driver within the relevant scope, if that is the confirmed business rule.
   - Handle uniqueness conflicts explicitly and preserve historical assignment rows. Never silently close or delete historical assignments to make a sync pass.
   - Use transaction-level locking or an equivalent concurrency strategy so overlapping syncs cannot create duplicate active assignments.

5. **Failure-injection tests**
   - Prove rollback when a vehicle, driver, or assignment mutation fails midway.
   - Test duplicate source IDs, duplicate fallback identities, cross-company identifier collisions, and ambiguous existing records.
   - Test concurrent sync attempts for the same company and driver.
   - Verify a failed transaction leaves all three entity groups unchanged.
   - Test that dry-run performs no Fleet-table reads or writes, and that writes remain blocked unless both independent opt-ins are present.

## Release gates

- [ ] Company migrations applied and tested only in a disposable environment, with row counts and rollback evidence.
- [ ] Company ownership transfer and NULL assignment behavior explicitly handled.
- [ ] Tenant RLS coverage reviewed for all fleet and operational data.
- [ ] Trusted administrator/role authorization implemented and tested.
- [ ] Transactional RPC reviewed against the tested schema.
- [ ] Tenant-scoped constraints and RLS reviewed.
- [ ] Failure-injection and concurrency tests pass.
- [ ] Dry-run reconciliation reviewed against expected Bolt counts.
- [ ] Explicit approval obtained before deployment or any live sync.

## Operational safety

The current dry-run still obtains a token and calls the live Bolt API; it only avoids Fleet-table reads/writes. Do not invoke it without explicit authorization to make live provider requests. Keep `BOLT_SYNC_ALLOW_WRITES` disabled until every release gate above is satisfied and the operation is explicitly approved.
