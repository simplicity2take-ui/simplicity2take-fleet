# Driver identity and assignment history security

**Status:** implemented in the versioned migration `supabase/migrations/20261103000100_fleet_assignment_history_security.sql`, on draft PR #37. The migration and its regressions run only in an isolated PostgreSQL database in GitHub Actions. It has not been applied to a production or hosted Supabase project.

## Protections

- Company administrators cannot change `drivers.profile_id` or move fleet records between companies. Those identity and ownership changes remain reserved to global administrators.
- Assignment history cannot be hard-deleted or edited directly through the API roles. The migration removes the assignment write policies and revokes direct INSERT, UPDATE and DELETE privileges.
- The authenticated fleet UI manages assignments with transaction-scoped RPCs. The RPCs verify the caller's company access, preserve closed intervals, and serialize competing assignment, deactivation and archive operations.
- Drivers cannot be deactivated while current or future assignments remain. Vehicles use the archive action to close their assignment history before becoming inactive.
- RPCs use a pinned empty `search_path`, explicit authorization checks and restricted EXECUTE grants. The API roles cannot call them as anonymous users.

## Flow and integration validation

The CI workflow provisions PostgreSQL 17 as a disposable service container, loads only the checked-in company/fleet migrations and fixture, then runs:

- Read-only catalog preflights for driver identity protection, assignment grants, platform RPC grants, tenant ownership links and archive/deactivation guards.
- Company isolation and the Empresa → Viaturas → Motoristas behavioral regression, including history preservation and forbidden cross-company operations.
- The platform-history tenant migration and all nine service-only Bolt/Uber RPCs, including synthetic Bolt event/trip writes, Uber status/reports/trips, cross-tenant ID rejection, tenant-scoped duplicate trip keys, and company-member RLS reads.
- Concurrent assignment-versus-deactivation and assignment-versus-archive regressions.
- Bolt response normalization, selected-vehicle handling, status mapping and provider-error envelope tests.
- Uber CSV parsing, locale-aware number and duration parsing, Lisbon time-zone and daylight-saving validation, and report-period checks.
- `node --check app.js` and Deno type checks for driver creation, Bolt sync and Uber report import.

The workflow runs on standard GitHub-hosted runners for this public repository. It does not create a Supabase project or invoke Bolt, Uber, Google Drive or other external APIs, so no paid service or provider credential is required. These checks validate local application and database behavior; they do not certify a live provider account or a production deployment.

## Historical proposal

`supabase/drafts/atomic_vehicle_assignments.sql` is retained for history and explicitly marked superseded. Do not apply it; use the versioned migration above.

## Release boundary

PR #37 remains a draft and depends on the company foundation in PR #32. No PR has been merged and no production or hosted database has been changed. Apply the dependency chain only after review and environment-specific operational approval.
