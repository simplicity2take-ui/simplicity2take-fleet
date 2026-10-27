# Company foundation — validation checklist

This checklist accompanies `20261026190000_company_fleet_foundation.sql`.
It is deliberately a review artifact; it does not execute SQL or modify a database.

## Before running in an isolated development database

1. Confirm `public.s2t_is_admin()` exists and returns the expected result for an active administrator.
2. Confirm `public.vehicles` and `public.drivers` exist and have no pre-existing `company_id` column with incompatible semantics.
3. Take a disposable snapshot/backup of the isolated database.
4. Run the migration only in that isolated database.
5. Confirm exactly one row exists for slug `simplicity2take`.
6. Confirm every existing vehicle and driver has a non-null `company_id` referencing that company.
7. Confirm the existing vehicle/driver row counts are unchanged.
8. Confirm an administrator can read the company and a non-admin authenticated user cannot.
9. Confirm existing driver access to their own profile/assigned vehicle/documents remains unchanged.
10. Confirm no non-admin user can insert, update, or delete company rows.

## Required before multi-company users are enabled

- Add an explicit company-membership model for authenticated staff users.
- Define whether a driver may belong to more than one company and how transfers are represented.
- Replace admin-only policies with company-scoped RLS policies for each relevant table, including assignments, documents, activity, trip records, and platform reports.
- Ensure all server-side functions validate company scope and never trust a client-supplied `company_id`.
- Add automated tests for cross-company reads and writes, including document access and historical assignments.

## Rollback note

Do not automatically drop `company_id` or the `companies` table as a rollback after real data has been entered. Rollback must first preserve/reconcile company references and be reviewed against the current schema.

## Current status

- Migration stored in a draft pull request only.
- Not applied to production.
- No production data was changed by this checklist.


## Follow-up membership/integrity migration

The draft `20261026200000_company_memberships_and_integrity.sql` depends on the company foundation migration and adds company memberships, membership helper functions, and a trigger that rejects a vehicle assignment when driver and vehicle company IDs differ.

Before testing that follow-up migration in isolation:

- Apply the company foundation draft to a disposable database first.
- Verify all existing drivers and vehicles receive the same expected company ID.
- Verify the existing assignments do not contain cross-company pairs before creating the trigger.
- Test insert and update of a same-company assignment succeeds.
- Test insert and update of a cross-company assignment fails with a check-constraint error.
- Test a missing driver/vehicle company ID fails closed.
- Test a normal authenticated user can see only their own membership, while the global administrator can manage memberships.
- Confirm company administrators cannot create memberships yet; that capability must be implemented through a separately authorized server-side workflow.
- Re-run existing driver and admin access tests.

The trigger enforces a data-integrity invariant; it is not a substitute for tenant-specific RLS on the rest of the schema.

## Additional checks after membership read policy was added

- With an active membership for Company A, the member can select Company A from `public.companies`.
- The same member cannot select Company B unless they also have an active membership there.
- An inactive membership grants no company read access.
- A company member cannot insert, update, or delete company directory rows; those writes remain global-admin-only.
- A profile with no membership cannot read any company row unless it is a global administrator.
- Test using real authenticated sessions and RLS, not only SQL executed as the database owner/service role, which can bypass RLS.

## Current live-data diagnostic (read-only, 27 October 2026)

The active project currently reports 0 rows in `platform_activity_events`, 1,079 rows in `platform_trip_records`, 24 rows in `uber_driver_activity`, and 27 rows in `vehicle_assignments`. This does not establish why platform activity events are empty. Before changing any import or sync, trace the Bolt ingestion path, its last successful run/logs, and the destination table used by the UI. Do not backfill or rerun imports against production until the source file, deduplication key, and write effects are reviewed.
