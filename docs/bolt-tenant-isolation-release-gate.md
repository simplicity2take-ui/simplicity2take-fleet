# Bolt tenant isolation — implementation gate (2026-11-04)

Status: **not implemented**. This document records a security boundary before any multi-company rollout. The current Bolt sync is for the existing single-company operation only.

## Verified source-level findings

- `supabase/functions/bolt-sync/index.ts` authorizes by a fixed administrator email, then uses the service-role client for database writes. This is not a tenant membership check.
- Bolt v2 resolves a single company from the provider response, but this provider company ID is not a verified local `companies.id` mapping.
- `upsertVehicle` matches globally by `bolt_vehicle_uuid`, then `plate`; `upsertDriver` matches globally by `bolt_driver_uuid`, then email or phone. Those fallbacks cannot safely cross tenant boundaries.
- `20261007193000_add_platform_activity.sql` creates `platform_activity_events` and `platform_trip_records` without `company_id`, and `sync_bolt_activity` resolves provider IDs globally.
- `platform_trip_records` has `unique(platform, source_trip_id)`; `platform_activity_events` has a globally unique `event_key`. Whether these keys are globally unique across provider accounts must be established before changing constraints.
- The existing RLS policies depend on `s2t_is_admin()` / `s2t_driver_id()`, not an explicit tenant membership check. Existing permissive policies must be inventoried before any replacements.

## Safe sequence (no production writes)

1. Run `supabase/tests/bolt_tenant_isolation_preflight.sql` against an authorized **staging copy**; inspect its output. The CI execution uses a minimal disposable fixture and cannot prove production tenant isolation.
2. Identify the canonical `companies` / membership schema and the exact tenant ownership chain for drivers, vehicles, assignments, activities and trips. Do not assume columns exist.
3. Design an explicit mapping of Bolt provider company/account to local company; reject missing, conflicting or ambiguous mappings.
4. Scope all driver/vehicle lookups, upserts, provider ID uniqueness and trip/event deduplication to that validated local company. Reject ambiguous email, phone and plate matches rather than selecting one.
5. Review every existing RLS policy and service-role / SECURITY DEFINER caller. Add tests with two companies that reuse a phone, email, plate, provider trip ID and event key; assert that no cross-company reads or writes occur.
6. Test migrations on disposable PostgreSQL and staging with rollback/recovery plan, then obtain explicit approval before any production migration or sync.

## Release gates

- CI Deno and PostgreSQL jobs green **after** tenant-aware changes.
- Runtime negative tests for cross-tenant access and cross-tenant provider identity collisions.
- Confirm the sync's partial-failure/compensation behavior under tenant conflicts.
- No automatic migration or deployment to production.

This document is a plan, not a claim that tenant isolation has been implemented or verified.
