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
