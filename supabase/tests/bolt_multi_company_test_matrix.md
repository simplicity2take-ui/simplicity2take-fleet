# Bolt multi-company negative-test matrix

**Status:** Test specification only. These cases are NOT currently executed and tenant isolation is NOT certified.

## Fixture (disposable staging database only)

Create local companies A and B with distinct memberships and users (admin A, admin B, driver A, driver B). Create driver and vehicle records owned by each company, using the actual ownership keys discovered by `bolt_tenant_isolation_preflight.sql`. Do not invent columns in a migration. Use synthetic data only.

| Case | Synthetic collision | Required result |
| --- | --- | --- |
| T01 | A and B drivers share email | A's sync never reads, updates or adopts B's driver; ambiguous matches fail closed |
| T02 | A and B drivers share phone | Same; no fallback across tenants |
| T03 | A and B vehicles share plate | A's sync never reassigns B's vehicle |
| T04 | Provider driver UUID collides across accounts | Mapping scoped to validated local company; conflict rejected |
| T05 | Provider vehicle UUID collides across accounts | Mapping scoped to validated local company; conflict rejected |
| T06 | Trip source ID identical in A and B | Both tenants retain independent records; no overwrite |
| T07 | Activity event key identical in A and B | Both tenants retain independent events; no overwrite |
| T08 | Driver A reads B's driver/vehicle/trip/activity | No B records returned, including via document access and RPCs |
| T09 | Admin A reads or modifies B's records | Denied by RLS and privileged server endpoints |
| T10 | Unmapped or ambiguous Bolt company/account | Sync refuses to write |
| T11 | Tenant mapping changes mid-sync | Sync fails closed; no cross-tenant partial writes |
| T12 | RPC assignment of driver A to vehicle B | Rejected without modifying assignments |
| T13 | Retry after ambiguous database response | Reconciles within A only; no duplicate or foreign assignment |
| T14 | Manual and historical assignments | Preserved for both tenants |
| T15 | Legacy broad permissive RLS policy remains | Test must detect access; do not certify until policy removed or constrained |
| T16 | Service-role import with crafted foreign IDs | Server validates tenant ownership independently of caller-supplied IDs |

## Acceptance evidence required

For each case: record fixture setup, caller role/JWT, operation, expected SQLSTATE or HTTP status, before/after row counts by company, and evidence of no foreign row changes. Execute with real migrations on disposable PostgreSQL and then authorized staging. CI must fail if any cross-tenant read or write succeeds.

## Preconditions

1. Inspect staging catalog, memberships, provider account mapping, all RLS policies, and SECURITY DEFINER functions.
2. Implement tenant-scoped database constraints, import lookup/upsert logic, authorization and RPC validation.
3. Never execute these tests on production or use actual customer/driver records.
4. Keep existing single-company behavior and Bolt regressions passing.

**No test in this document is claimed to pass today.**
