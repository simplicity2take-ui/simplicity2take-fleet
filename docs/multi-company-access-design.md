# Multi-company access design — Fleet

Status: design review only. No production schema or application code is changed by this document.

## Existing model verified against the active project schema

The current data model contains profiles, drivers, vehicles, vehicle assignments, documents and document viewers. Operational history is also stored in platform activity events and trip records. Uber report tables and CarTrack vehicle/snapshot tables are present. The application currently loads drivers, vehicles, assignments, documents, Bolt activity, platform trips and CarTrack records directly through the authenticated Supabase client.

The company foundation migration adds ownership anchors only to `drivers` and `vehicles`. That is intentionally insufficient to enable separate companies.

## Read-only baseline observed during review

At the time of the read-only check on 26 October 2026, the active project contained 29 driver records, 27 vehicles, 27 vehicle assignments, 2 documents, 0 platform activity events and 1,079 platform trip records. These are a snapshot for planning, not fixed acceptance targets. The review did not insert, update or delete production data.

The inspected RLS policies currently use administrator/assigned-driver access for core fleet tables and trip history. They do not yet express company-level isolation, which is why the draft ownership columns must not be treated as enabling multi-company access.

## Scope matrix

| Data area | Required tenant rule before external companies |
|---|---|
| companies | Only active company members can read their company; company administrators can manage allowed fields |
| profiles | A staff profile can see only itself and permitted company staff; global administrator access remains explicit |
| drivers | Scope by company membership; driver self-access must remain constrained to their own record |
| vehicles | Scope by owning company |
| vehicle_assignments | Scope through both driver and vehicle company; reject assignments across different companies |
| documents | Scope through owning company and/or associated driver/vehicle; preserve explicit viewer permissions |
| document_viewers | Scope through document company and driver company; reject cross-company grants |
| platform_activity_events | Scope through company-owned driver/vehicle; unresolved identities must not leak across tenants |
| platform_trip_records | Scope through company-owned driver/vehicle; historical unmatched rows require an explicit handling rule |
| Uber report tables | Add a clear company key or enforce a safe join to the company-owned driver/vehicle; define retention and import scope |
| CarTrack vehicles/snapshots | Scope by mapped Fleet vehicle/company; do not expose raw telemetry across tenants |
| applications and application documents/messages | Assign each application to a company/recruitment tenant before sharing; candidate documents are sensitive |
| app_settings and audit_log | Separate global settings from company settings; audit records must preserve company scope and administrator identity |

## Required invariants

1. A driver and a vehicle cannot be assigned to each other across companies.
2. Company scope is derived from trusted membership/record relations, never accepted blindly from browser-supplied IDs.
3. Service-role Edge Functions must validate company scope independently; RLS does not protect service-role operations.
4. Document previews/downloads must verify authorization server-side and use short-lived access URLs.
5. Deactivating a company must block new operations without deleting historical activity or financial records.
6. A driver transfer between companies must preserve history and explicitly close the old assignment.
7. Missing or ambiguous company mapping must fail closed, not default to the first company.
8. Global administrators and company administrators are different roles and must not be conflated.

## Recommended implementation sequence

1. Test the existing company-foundation migration in an isolated development database.
2. Decide the driver-transfer policy and confirm company membership roles.
3. Review the draft membership/integrity migration; it introduces memberships and blocks cross-company driver/vehicle assignments, but it does not finish tenant RLS.
4. Draft migration `20261030210000_platform_history_company_rls.sql` scopes platform activity and trip-history reads to the linked driver's/vehicle's single owning company, while retaining driver self-access and global-admin access. Conflicting driver/vehicle company mappings fail closed for company members.
5. Add company scoping and integrity constraints to documents and document viewers.
6. Add RLS to Uber report tables, imports and CarTrack data.
7. Update every server-side function using the service role to validate tenant scope explicitly.
8. Add automated negative tests proving Company A cannot read or modify Company B data.
9. Add company selector and the Empresa → Viaturas → Motoristas UI only after the database/API contract is stable.

## Current safety boundary

Do not apply the draft migrations to production and do not enable external-company accounts until the above controls are implemented and tested. The platform-history RLS migration is a draft and has not been executed. No production writes were performed as part of this design review.

## Bolt sync — assignment-history safeguard (30 October 2026)

The company-foundation branch now scopes Bolt driver/vehicle identity lookups and inserts to the server-resolved Simplicity2Take company. The assignment step has also been changed to preserve history:

- One active assignment already pointing to the Bolt-reported vehicle is left unchanged.
- Any existing active assignment that differs, or multiple active assignments, is preserved and counted as a conflict for manual review.
- A new assignment is inserted only when no active assignment exists.
- The sync no longer deletes all assignments for a driver.

This is a safeguard, not a complete multi-company integration. The Bolt function still uses the existing global-admin email gate, service-role access, and sequential writes. The provider endpoint/pagination contract and transactional all-or-nothing apply phase remain unverified. The branch's assignment behavior has not yet been exercised against a disposable database with fixtures for matching, conflicting, multiple-active and no-active cases. Do not deploy or run a live sync based on this change alone.

## Documents and document viewers — company access draft (30 October 2026)

Added draft migration `20261030220000_company_documents_rls.sql` and read-only diagnostics `supabase/tests/company_documents_preflight.sql`.

- Adds `documents.company_id` and derives it from the linked driver/vehicle ownership.
- If both links exist but belong to different companies, ownership remains NULL (fail closed for company-member access).
- Documents without a driver or vehicle are assigned to the existing `simplicity2take` company.
- Global administrators and company administrators can read documents in their authorized scope; ordinary company members can read company-level documents without a driver/vehicle link.
- Drivers retain existing access to their own documents, currently assigned vehicles, and explicit viewer grants.
- Company administrators can inspect viewer grants only for documents belonging to their company.
- Existing administrator-only write policies are retained; no company-member document write workflow is granted.

The document-access Edge Function continues to authenticate the user and read the document through caller RLS before retrieving the private Drive file. Its method handling and error response have been hardened: only POST is accepted, raw provider/database errors are not returned, and the response is marked non-cacheable and nosniff.

### Validation still required

- Confirm actual deployed columns and constraints for `documents` and `document_viewers` in a disposable database.
- Test company-admin A vs company-admin B, ordinary member, driver self, assigned-vehicle driver, explicit viewer, global admin, and unaffiliated user with separate authenticated sessions.
- Test document rows with no links, one link, matching driver+vehicle, mismatched driver+vehicle, missing parent rows and pre-existing company_id values.
- Confirm document upload/edit/delete workflows remain global-admin-only until a separately authorized company workflow is implemented.
- Verify that Drive file IDs and web-view links are never exposed to unauthorized users.

This is draft SQL/source only. The migration and diagnostics have not been executed, the Edge Function has not been deployed, and no production data or Drive files were accessed or changed.

### Company-member frontend loading boundary

The portal now resolves the authenticated user's active `company_memberships` row before loading operational data. If a non-global-admin user has an active company membership, the frontend requests only `documents` and relies on the documents RLS policy for the permitted rows. It does not request drivers, vehicles, assignments, platform activity/trips, applications, or CarTrack data in that session.

Company-member navigation is limited to the company-document view and account settings. This is deliberately restrictive until dedicated company-scoped RLS policies and company-admin write workflows exist for each operational table. A company membership must not be treated as authorization to query the whole fleet.

The company-member view is read-only. Ordinary members see company-level documents only; company-admin document write and linked driver/vehicle document browsing remain incomplete. Do not enable external company onboarding until the relevant RLS policies, isolated-database tests, and UI workflows are completed.


## Core fleet RLS — company-scoped draft (30 October 2026)

Added draft migration `20261030230000_company_fleet_rls.sql` and read-only diagnostic `supabase/tests/company_fleet_rls_preflight.sql`.

Proposed policy behavior:

- Company members can read drivers and vehicles owned by their active company.
- Drivers retain self access to their own driver row and access to currently assigned vehicles.
- Company administrators can insert/update drivers and vehicles in their company. Deletion remains global-admin-only to preserve operational history.
- Company members can read assignments only when the driver and vehicle resolve to the same company.
- Company administrators can create, update and delete assignments only when both records belong to their company.
- A trigger rejects driver/vehicle company ownership changes by non-global administrators.
- Assignment read checks use a SECURITY DEFINER helper to avoid a recursive RLS dependency between vehicles and vehicle_assignments.

### Required isolated-database test matrix

| Actor | Read own company fleet | Read another company | Create/update own fleet | Cross-company assignment | Delete fleet record |
|---|---:|---:|---:|---:|---:|
| Global admin | Yes | Yes | Yes | No (integrity trigger) | Yes |
| Company admin A | Yes | No | Yes | No | No |
| Ordinary member A | Yes | No | No | No | No |
| Driver A | Own driver + assigned vehicles | No | No | No | No |
| Unaffiliated user | No | No | No | No | No |

Also test assignment rows with missing parents, duplicate active assignments, reassignment between vehicles in the same company, attempted company_id changes, and a user with memberships in more than one company.

### Validation status and caveats

These are source drafts only. No SQL has been executed. The preflight must confirm the deployed `vehicle_assignments` primary key and columns (`id`, `driver_id`, `vehicle_id`, `active`) before the migration is considered runnable. Check for any additional permissive policies in the live database: PostgreSQL permissive policies are combined with OR, so an overlooked legacy policy could widen access. Run the full matrix with separate authenticated sessions in a disposable database before enabling company fleet navigation.

The frontend intentionally remains docs-only for company members until the fleet RLS migration has been tested and applied in the intended environment. No company-member fleet queries, migrations, syncs or deployments were enabled by adding this draft.


## Remaining data inventory — next isolation phase (30 October 2026)

Added read-only diagnostic `supabase/tests/company_remaining_data_preflight.sql`. It discovers the actual public tables, columns, RLS flags, policies, foreign keys and SECURITY DEFINER function definitions for Uber, Bolt, CarTrack, applications/candidates, profiles, documents, platform history, settings and audit data.

No tenant migration for these areas is generated yet. The next migration must be based on the returned schema and relationship map, not guessed table names or browser-supplied `company_id` values.

### Required decisions before the next SQL migration

- **Uber reports:** determine whether each row links to a trusted driver UUID, provider driver ID, import batch, or only a file. Rows with ambiguous identity must remain admin-only.
- **CarTrack:** scope through a verified Fleet vehicle mapping. Unknown/unmatched tracker IDs must remain inaccessible to company members.
- **Applications/candidates:** establish which company owns each recruitment campaign/application and ensure private candidate documents/messages inherit that scope. Do not make candidate data visible to all company members by default.
- **Profiles:** use `company_memberships` as the staff-company relationship unless schema review establishes a stronger trusted relation. Avoid email-domain or client-supplied tenant inference.
- **SECURITY DEFINER / service-role functions:** inspect each import/sync function separately. RLS does not protect operations performed with the service role; each function must resolve the caller and company server-side and reject ambiguous scope.

### Validation status

The new diagnostic is SELECT-only and has been committed to the feature branch. It has not been run against staging or production. No additional tenant policies, schema changes, external syncs or deployments were made in this phase.
