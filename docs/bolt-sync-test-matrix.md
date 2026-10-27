# Bolt sync test matrix and release gate

This is a test plan only. It does not call Bolt, write to Supabase, deploy an Edge Function, or alter production data.

## Unit-level checks

| Case | Input / setup | Expected result |
|---|---|---|
| Duplicate driver UUID | Two payload records normalize to the same UUID, ignoring case/outer whitespace | Reject the payload before any database writes |
| Duplicate vehicle UUID | Two payload records normalize to the same UUID, ignoring case/outer whitespace | Reject the payload before any database writes |
| Missing vehicle identity | Vehicle has neither UUID nor registration | Abort with a clear validation error |
| Missing driver identity | Driver has no UUID, email or phone | Abort with a clear validation error |
| Inactive status | `inactive`, `deactivated`, `blocked`, `rejected` | Map to Inativo |
| Active status | Exact known values `active`, `activated`, `enabled`, `approved` | Map to Ativo |
| Unknown status | Any unrecognized value for a new record | Remain Inativo; do not silently activate |
| Same active assignment | Exactly one active row with the vehicle Bolt reports | Do not write to assignment table |
| Different active assignment | One active row for another vehicle | Preserve existing row and report conflict |
| Multiple active assignments | More than one active row | Preserve all rows and report conflict |
| No active assignment | Bolt vehicle maps to a Fleet vehicle | Create one active assignment |
| No vehicle match | Bolt reports an unknown vehicle | Do not create/replace an assignment |

## Integration tests required in an isolated Supabase project

1. Seed a small fixture with two companies, two drivers, two vehicles and assignment history.
2. Use mocked Bolt responses; do not call the live Bolt endpoint.
3. Snapshot row counts and assignment rows before each test.
4. Inject a failure after the first vehicle write and before the driver loop; inspect whether partial writes remain.
5. Inject a failure during the driver loop after one successful driver; inspect whether partial writes remain.
6. Verify retry behavior after each injected failure and prove it does not create duplicates.
7. Test that the service-role Edge Function cannot select/update a record belonging to a different company once company scope is implemented.
8. Verify error logs do not include access tokens, client secrets, or full sensitive driver data.

## Release blockers

- No transaction/staging-and-commit design or tested recovery behavior for partial writes.
- The exact Bolt request/response and pagination contract is not confirmed.
- Function currently uses a hard-coded administrator email and global driver/vehicle matching.
- Tenant isolation has not been demonstrated with authenticated sessions and negative cross-company tests.
- Assignment conflict behavior has not been exercised against a test database.

## Safe release sequence

1. Implement automated tests for the pure normalization/status/duplicate-identity helpers.
2. Implement a database transaction or staged sync with a clear commit boundary; if using a SQL RPC, keep all writes for a sync inside one transaction and validate input inside the RPC.
3. Scope all lookups and writes to the trusted company membership, not a browser-supplied company ID.
4. Confirm Bolt pagination from authenticated API docs or an approved non-production fixture.
5. Run the isolated integration suite and review the diff.
6. Only after explicit approval, schedule deployment and a controlled live sync with a backup and post-sync reconciliation.

## Current state

The Deno type-check passed on commit `5d409bc5be403c6a1251b41ca3d6ad2fe9c8ef13`. That check validates types only. No behavioral/integration test is claimed complete here. No production sync or deployment is authorized by this document.
