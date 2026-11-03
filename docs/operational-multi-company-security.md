# Multi-company operational security — next-stage inventory

## Purpose
This stage inventories the real Supabase schema before adding tenant RLS to operational integration data. It deliberately does not guess table names, foreign keys, or ownership columns.

## Read-only diagnostic
Run `supabase/tests/operational_multi_company_security_inventory.sql` in a staging/isolated Supabase project. It reads PostgreSQL catalogs only and does not change data or policies.

The report returns:
1. Public tables/views and RLS/force-RLS status.
2. Every existing public RLS policy and its USING/WITH CHECK expressions.
3. Column inventory with hints for tenant, driver, vehicle, personal-data, credential and file-reference fields.
4. Foreign-key paths between public tables.
5. SECURITY DEFINER functions, pinned settings, owners and ACLs.
6. View definitions that may affect RLS boundaries.

## Tenant policy design rules
- Prefer a persisted, server-validated `company_id` on each operational fact table where practical.
- If a table is linked through a driver or vehicle, verify that relationship is a real FK and that the parent is tenant-owned before deriving company scope.
- For trip/activity/payment rows, scope reads and writes by the company owning the referenced driver and reject cross-company driver/vehicle combinations.
- Do not trust a company ID supplied by a browser, CSV, Bolt/Uber import payload, or external platform.
- Keep integration credentials server-side; never return tokens or secret fields to the browser.
- Review Edge Functions that use `service_role`: RLS is bypassed for those queries, so the function must authenticate the caller and apply tenant scope explicitly.
- Review views, SECURITY DEFINER functions, Storage policies and RPCs separately; table RLS alone is not a complete security boundary.
- Do not add permissive policies without reviewing existing policies: permissive policies combine with OR semantics.
- Keep global-admin access separate from company-admin and ordinary-member access.

## Known areas awaiting schema evidence
- Uber activity, trips and payment imports.
- Bolt activity/trip history and driver/vehicle synchronisation.
- CarTrack telemetry and vehicle mileage.
- Recruitment applications and uploaded candidate documents.
- Any reporting aggregates or exports based on the above.

## Rollout status
This is an inventory and design stage only. No SQL migration is included for these tables yet. No query was run against the user's Supabase database, no policies were changed, and no Edge Function was deployed. The actual catalog output is required before safely designing tenant policies.
