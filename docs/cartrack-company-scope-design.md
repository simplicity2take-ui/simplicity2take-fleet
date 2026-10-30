# CarTrack — tenant ownership and mileage isolation design

**Status: design only.** This document does not alter the database, call CarTrack, deploy an Edge Function, or change production data.

## Current source-review finding

The current CarTrack Edge Function authenticates the caller and restricts execution to the active global administrator. It then uses the Supabase service-role client to call the RPC `sync_cartrack_data` with vehicle and snapshot arrays. The payload does not carry a trusted tenant mapping, and the function does not resolve a company for each CarTrack vehicle before writing.

The current draft company migrations add ownership to drivers, vehicles, documents and selected platform/report tables, but do not add tenant ownership or tenant-aware access rules for:

- `cartrack_vehicles`
- `cartrack_vehicle_snapshots`
- `vehicle_odometer_readings`

Because the Edge Function uses service_role, ordinary RLS does not automatically scope its queries. This path must be redesigned before external companies can use the Fleet.

## Canonical ownership model

The Fleet vehicle record remains the source of truth for company ownership.

1. Every CarTrack vehicle must resolve to exactly one canonical `public.vehicles.id`.
2. The canonical vehicle's `company_id` determines the tenant for all telemetry and odometer facts.
3. Persist the external CarTrack vehicle identifier separately from the canonical Fleet vehicle ID.
4. A CarTrack external ID must be unique within the appropriate provider-account/company scope, not assumed globally unique across all customers.
5. Registration matching is only a controlled fallback. Normalize the registration consistently and require exactly one match inside the already-resolved company. Never search globally and then infer the tenant.
6. If the external ID is unknown, the registration is ambiguous, or the canonical vehicle is outside the configured company, quarantine the row and report a mapping conflict. Do not silently create a new Fleet vehicle or attach telemetry to a different company.
7. A company must have an explicit server-side CarTrack account/credential mapping. Never accept a company ID or provider-account ID from the browser or provider response as authorization.

## Suggested data relationships

The exact existing columns and foreign keys must be inspected in an isolated schema before writing migrations. The target logical relationships are:

- `cartrack_vehicles`: one provider vehicle mapping to one canonical Fleet vehicle; tenant ownership derived from that canonical vehicle and optionally stored as a consistency-check column.
- `cartrack_vehicle_snapshots`: each snapshot references the canonical CarTrack mapping row; tenant scope follows the mapping and canonical vehicle.
- `vehicle_odometer_readings`: each reading references the canonical Fleet vehicle and records the source (CarTrack/manual/import), observation timestamp, odometer value and audit metadata. Tenant scope follows `vehicles.company_id`.
- All foreign keys must prevent cross-company references. If `company_id` is persisted redundantly on a fact table, a trigger/constraint must verify it equals the canonical vehicle's company.

Do not add guessed column names or constraints until the catalog inventory confirms the actual schema.

## Edge Function and RPC contract

The server-side flow should:

1. Authenticate the user and verify an active global-admin or explicitly authorized company-admin role.
2. Resolve the permitted company and CarTrack credential set from trusted database/configuration state.
3. Fetch CarTrack vehicles/status using only that company's credentials.
4. Normalize external IDs, registrations, timestamps and odometer units.
5. Resolve each external vehicle to exactly one canonical Fleet vehicle within that company.
6. Send normalized records to one narrowly scoped RPC that revalidates company ownership and performs the upsert.
7. Return counts for matched, updated, ignored and mapping-conflict records; do not return raw provider payloads or SQL exception text.

For the initial rollout, if only one CarTrack account exists, keep the function restricted to the existing global administrator and the fixed S2T company. This is a single-tenant safety measure, not a multi-company implementation.

## Access policy rules

- Global administrators may inspect all CarTrack records.
- Company administrators may read telemetry and mileage only for canonical vehicles owned by their company.
- Ordinary company members should receive only the minimum telemetry fields required for their role.
- Drivers may see only the permitted telemetry for a vehicle currently assigned to them, if that is an approved product requirement.
- No company member may change the tenant owner of a CarTrack mapping.
- Raw provider payloads, credentials, account identifiers and integration diagnostics must remain server-side.
- Exports, dashboards and aggregate reports must apply the same company filter; hiding a table in the UI is not access control.

## Failure and data-quality behavior

- Unknown CarTrack vehicle ID: quarantine and report; no automatic Fleet vehicle creation.
- Duplicate external IDs within one account: abort or quarantine the affected records; never pick an arbitrary row.
- Registration maps to multiple canonical vehicles: quarantine as ambiguous.
- CarTrack vehicle maps to a vehicle in another company: reject and record a redacted conflict.
- Missing or malformed odometer: preserve the previous valid reading; do not replace it with zero.
- Older observation timestamp: do not overwrite a newer current snapshot; keep history according to the approved retention policy.
- Provider timeout or partial page: do not mark the fleet as fully synchronized. Verify pagination/completeness before applying.
- Database failure during apply: transaction rollback or a documented idempotent recovery strategy is required.

## Required tests in a disposable Supabase database

1. Company A CarTrack account maps only to Company A vehicles.
2. Company B cannot read Company A mappings, snapshots or odometer readings.
3. Identical registration values in two companies never cross-map.
4. Same external CarTrack ID under two separate provider accounts is handled by the approved scoped unique key.
5. Unknown and ambiguous external IDs are quarantined without creating Fleet vehicles.
6. A mapping to another company's canonical vehicle is rejected.
7. A company_admin cannot update the mapping's company ownership.
8. A driver sees only telemetry for a currently assigned vehicle, if driver telemetry access is enabled.
9. Missing odometer values do not overwrite a previous valid value with zero.
10. Out-of-order snapshots do not regress the current odometer.
11. A simulated database failure leaves no partial telemetry/snapshot changes.
12. Edge Function errors do not expose raw provider bodies, SQL details, credentials or full raw records.
13. Service-role RPC calls with an invalid/unconfigured company mapping are rejected.
14. Two companies can sync independently without reading or updating one another's data.

Use synthetic records only. Tests of RLS must use separate authenticated sessions for each company; service-role reads do not prove RLS isolation.

## Release gates

- [ ] Capture actual CarTrack table definitions, foreign keys, RLS policies and RPC body from a disposable schema.
- [ ] Confirm the exact external ID/account scope and API pagination/completeness contract.
- [ ] Decide whether CarTrack data is company-owned, account-owned or both, and document the mapping.
- [ ] Implement canonical vehicle mapping and tenant-scoped constraints.
- [ ] Replace the global `sync_cartrack_data` write path with a tenant-validating RPC.
- [ ] Add RLS and test direct table reads as Company A, Company B, driver and unauthenticated user.
- [ ] Add telemetry/mileage history, timestamp ordering and rollback tests.
- [ ] Redact provider and SQL errors at the Edge Function boundary.
- [ ] Keep production migrations/deployment and live CarTrack sync blocked until explicit approval.

## Zero-cost and production-safety rules

Use only existing local tooling and synthetic fixtures. Do not provision a paid Supabase project or branch. If the isolated test environment is unavailable, mark the integration tests BLOCKED and continue with static review. Do not apply migrations, alter production rows, deploy Edge Functions, or call the live CarTrack API as part of this design.


## Verified current-schema inventory (read-only inspection, 30 October 2026)

The production catalog was inspected with SELECT/catalog queries only. No data or schema was changed.

- `cartrack_vehicles.vehicle_id` is a nullable `bigint` provider identifier, not a foreign key to `public.vehicles.id` (UUID).
- `cartrack_vehicle_snapshots.vehicle_id` is also a nullable `bigint` provider identifier. Snapshots have no foreign key to the canonical Fleet vehicle or the mapping row.
- `cartrack_vehicles.registration` has a global unique constraint. This prevents the same registration being represented in two provider accounts/tenants and is not an appropriate multi-account key.
- `cartrack_vehicle_snapshots` is indexed by registration and observed time, not by a canonical vehicle FK.
- `vehicle_odometer_readings.vehicle_id` is already a canonical UUID FK to `vehicles(id)`, but its source CHECK currently permits only `tesla` and `manual`. It does not yet accept `cartrack`.
- All three tables have RLS enabled but not forced. Their current SELECT policies are global-admin-only; no company-scoped policy exists.
- The existing `sync_cartrack_data(jsonb,jsonb)` is `SECURITY DEFINER`, uses `search_path=public`, checks for the `service_role` claim, and upserts the vehicle table by global registration. It does not resolve or validate a canonical Fleet vehicle/company before writing.
- The current Edge Function sends provider IDs into the bigint `vehicle_id` columns, uses one global CarTrack credential pair, and returns raw provider error text / database exception details. Error redaction is being handled separately in PR #38.
- The aggregate match check found 23 CarTrack mapping rows: 21 matched exactly one current Fleet vehicle by normalized registration, 2 had no match, and none were ambiguous. These two unmatched rows must remain unresolved/quarantined; no automatic matching or row edits were performed.
- The existing CarTrack tables show an effective `TRUNCATE` privilege for `anon` and `authenticated` despite RLS being enabled. This is an unexpected grant because RLS does not govern TRUNCATE; its source and necessity must be reviewed and revoked in a separately validated migration. No privilege was changed.
- The existing odometer table has a cascading FK to vehicles. Before tenant enablement, parent deletion protection must be coordinated with the fleet-history protection work so telemetry history cannot be erased indirectly.

The read-only query bundle is saved as `supabase/tests/cartrack_tenant_inventory_preflight.sql`. It returns catalog metadata and aggregate counts, not registration values or provider payloads.


## Proposed implementation sequence after the schema inventory

1. **Preserve the legacy provider identifier.** Keep the existing bigint `cartrack_vehicles.vehicle_id` and snapshot `vehicle_id` as CarTrack provider IDs. Do not reinterpret or overwrite either column with a Fleet UUID.
2. **Introduce an explicit account boundary.** Add a server-managed CarTrack account record associated with one `company_id`; store only a secret reference in the database, never the username/password. The Edge Function resolves credentials and account scope server-side. No account ID or company ID from the browser is authoritative.
3. **Create a canonical mapping relation.** Map `(CarTrack account, provider vehicle ID)` to one `public.vehicles.id`. Derive the company from the canonical Fleet vehicle and validate it against the account's company. Add account-scoped uniqueness rather than relying on global registration uniqueness.
4. **Link snapshots to the mapping.** Add a UUID FK from each new snapshot to the mapping row. Keep the old registration/provider-ID columns during a controlled backfill and audit window; do not drop or repurpose them until all retained snapshots are reconciled.
5. **Resolve existing rows conservatively.** The aggregate read-only check reports 21 uniquely matched registrations and 2 unmatched records. The 21 are candidates for an explicit reviewed mapping; the 2 unmatched rows stay quarantined. No bulk update should run until each candidate is confirmed against trusted fleet records and provider account data.
6. **Extend odometer history deliberately.** Add CarTrack as an allowed source only in a reviewed migration, and define an idempotency key for provider observations. Preserve existing Tesla/manual constraints and reject null, negative, malformed or older readings from overwriting a newer current value.
7. **Replace the writer contract.** Replace the global-registration upsert with an account-scoped RPC that validates account status, company ownership, mapping, input ranges and timestamp order in one transaction. Keep execution restricted to the server integration role; do not rely on RLS to constrain service_role.
8. **Enforce tenant reads.** Company policies must derive ownership through the canonical Fleet vehicle/mapping relation. Test company A and B in separate authenticated sessions; a service-role query is not an RLS test.
9. **Remove unnecessary TRUNCATE privileges.** Revoke unexpected TRUNCATE privileges from `anon`, `authenticated` and `service_role` on CarTrack tables after confirming no legitimate maintenance workflow depends on them. RLS does not filter TRUNCATE operations.
10. **Only then enable multi-company sync.** Until account credentials, provider pagination/completeness, mapping and rollback tests are ready, keep the current integration limited to the global administrator and one configured account.

## Explicit non-goals for the current review

- Do not attempt to resolve the two unmatched CarTrack rows by guessing from a registration or provider ID.
- Do not change the existing 23 mapping rows or 69 snapshots.
- Do not change production grants, RLS, function definitions or data.
- Do not call CarTrack's live API or deploy the Edge Function.
- Do not claim tenant isolation merely because the tables have RLS enabled: the current policies are global-admin-only, and the service-role writer bypasses RLS.


## Additional CarTrack security-advisor finding

A read-only Supabase Security Advisor check (30 October 2026) reported `public.get_cartrack_fleet_data()` as a SECURITY DEFINER function executable by `authenticated`. Inspection confirms it:
- uses `SECURITY DEFINER` with `search_path=public`;
- returns complete `to_jsonb` rows from both CarTrack tables, including the stored raw provider payloads;
- applies `where public.s2t_is_admin()` before returning the JSON.

This is not, by itself, proof of an authorization bypass: the function has an explicit global-admin predicate. It is nevertheless a privileged public-schema RPC with a broad result shape and should be reviewed for least privilege. The target design should expose only allowlisted telemetry fields, keep raw provider payloads server-side, pin an empty search_path with fully qualified object names, and restrict EXECUTE to the narrowest required role. Do not change the existing function's grants until its callers and dependencies have been checked.

The advisor also reported three other SECURITY DEFINER helper functions and a disabled leaked-password protection setting. Those are tracked as separate platform-wide security work, not silently changed in this CarTrack task.
