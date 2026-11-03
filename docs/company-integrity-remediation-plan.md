# Company integrity remediation plan

Status: design guidance only. This file does not change schema and is not authorization to apply migrations.

## 1. Assignment integrity must fail closed

The current draft `s2t_guard_assignment_company()` rejects NULL `driver_id` or `vehicle_id` and rejects pairs whose driver and vehicle have different company IDs. This has not been executed in an isolated database.

Before enabling multi-company data:

- Verify `vehicle_assignments.driver_id` and `vehicle_assignments.vehicle_id` nullability, foreign keys, and existing NULL rows in an isolated database.
- If either identifier is nullable, decide explicitly whether the schema permits unassigned rows. For active driver-to-vehicle assignments, prefer reviewed `NOT NULL` constraints after auditing existing data.
- Test inserts and updates with NULL driver, NULL vehicle, nonexistent IDs, same-company pairs, and cross-company pairs.
- Confirm failed statements leave no partial changes.

## 2. Guard company ownership changes

The current assignment trigger runs when an assignment is inserted or its driver/vehicle reference changes. It does not run when the referenced driver's or vehicle's `company_id` changes.

Before allowing ownership changes, implement one of these reviewed strategies:

1. **Restricted transfer workflow (preferred):** revoke direct company ownership updates from ordinary application roles. A narrowly scoped server-side workflow validates permissions, locks the driver/vehicle and active assignments, closes or reconciles assignments, records the transfer, then changes ownership in one transaction.
2. **Database enforcement:** add carefully designed triggers/constraints that validate every affected assignment on ownership change, with concurrency-safe locking and clear historical ownership semantics.

Do not simply update `company_id` while active assignments exist. Preserve historical assignment records and define how reports attribute historical activity after a transfer.

## 3. Membership provisioning and authorization

- Keep membership creation/revocation restricted to a trusted server-side workflow or global administrator until an invitation process is reviewed.
- Never let a user grant themselves a company membership or promote their own role.
- Verify active membership and role server-side for every company-scoped mutation.
- Test unaffiliated users, inactive memberships, multiple memberships, global admins, and company admins with separate authenticated sessions.
- A `company_admin` label is not sufficient authorization unless each operation checks it and the policies match the intended permissions.

## 4. Tenant coverage inventory

Adding `company_id` to drivers and vehicles alone is not tenant isolation. Inventory and scope every table and server-side path that may expose fleet data, including:

- vehicle assignments and assignment history;
- driver/vehicle documents and document previews/downloads;
- trips, platform activity, Uber/Bolt reports and reconciliation data;
- CarTrack telemetry and mileage;
- recruitment records and candidate documents, where applicable;
- audit events, settings, payment/order records, and exports.

For records without a direct `company_id`, define a safe ownership path and handle orphaned or ambiguous historical rows explicitly. Never assume RLS protects a function using a service-role client; add explicit authorization and company filters in that function.

## 5. Zero-cost validation sequence

1. Use a disposable **local** PostgreSQL/Supabase environment only if the required tools are already installed and usable without payment.
2. If local database tooling is unavailable, mark database execution **BLOCKED**. Do not create a cloud project or branch, start a paid service, or substitute production for a test environment.
3. Use synthetic fixtures only; never copy production records or secrets into a test environment.
4. Capture baseline row counts, NULL ownership counts, assignment validity, and existing constraints in the disposable environment.
5. Apply the draft migrations in order; inspect the resulting schema and policies.
6. Test same-company success and cross-company denial for assignments and every tenant-scoped table.
7. Test ownership transfer with active and historical assignments, including concurrent operations.
8. Test membership and RLS using authenticated user sessions, not only SQL executed as an elevated role.
9. Re-run migrations only if they are designed to be idempotent; verify no row-count or ownership drift.
10. Test rollback and recovery only in the disposable environment.
11. Record commands, tool versions, test outcomes, schema snapshots, and exact commit SHA before any release decision.

## Release blockers

Do not apply these migrations to production, enable external company accounts, or deploy Bolt writes until tenant coverage, assignment integrity, ownership-transfer semantics, membership authorization, rollback, and isolated test evidence are reviewed and approved.

No production migration, deployment, merge, or live Bolt API request is authorized by this document.
