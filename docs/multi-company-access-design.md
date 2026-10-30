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
