# Bolt sync test matrix and release gate

This is a test plan only. It does not call Bolt, write to Supabase, deploy an Edge Function, or alter production data.

## Unit-level checks

| Case | Input / setup | Expected result |
|---|---|---|
| Duplicate driver UUID | Two payload records normalize to the same UUID, ignoring case/outer whitespace | Reject the payload before any database writes |
| Duplicate driver email | Two records share an email, including different UUIDs | Reject the payload before any database writes |
| Duplicate driver phone | Two records share a phone after whitespace normalization, including different UUIDs/emails | Reject the payload before any database writes |
| Duplicate vehicle UUID | Two payload records normalize to the same UUID, ignoring case/outer whitespace | Reject the payload before any database writes |
| Duplicate vehicle registration | Two records share a registration after spaces/hyphens are removed, including different UUIDs | Reject the payload before any database writes |
| Missing vehicle identity | Vehicle has neither UUID nor registration | Abort with a clear validation error |
| Missing driver identity | Driver has no UUID, email or phone | Abort with a clear validation error |
| Conflicting driver UUID on fallback match | Email/phone matches a Fleet driver already linked to a different Bolt UUID | Reject before updating the matched record; manual review required |
| Conflicting vehicle UUID on fallback match | Registration matches a Fleet vehicle already linked to a different Bolt UUID | Reject before updating the matched record; manual review required |
| Compatible external UUID formatting | UUID differs only by surrounding whitespace or letter case | Treat as the same UUID; do not create a false conflict |
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

The Deno type-check and unit tests passed on commit `ee8cbccd40062f5528d83f166c1d2e6b94d83b92` (workflow run 40586829378). The code now also checks that fallback matches do not silently replace a different stored Bolt UUID, with tests for conflicts, case and whitespace normalization. The latest CI run must be checked before treating the newest test edits as passed. Unit tests cover the pure helper cases, including fallback identity duplicates. They do not exercise database writes, tenant isolation, rollback, Bolt API pagination, or browser behavior. No behavioral/integration test against Supabase is claimed complete here. No production sync or deployment is authorized by this document.


## Source review — pagination and request retries (27 October 2026)

Static review of `supabase/functions/bolt-sync/index.ts` confirms that `boltPost()` currently tries up to three request bodies (`pager`, `page`, and an empty object), each starting at offset zero with a limit of 1000 where a paging object is supplied. It returns the first HTTP-success response and does not follow a next-page token, offset, cursor, or page count.

Consequences:
- A successful response does not prove that all drivers and vehicles were retrieved.
- If the API rejects a request with an authorization or server error, the function may retry with alternate bodies even though changing the body cannot fix that class of error.
- The application-level error check only rejects a payload when `code` exists and is nonzero; the exact success/error envelope still needs confirmation against the authenticated Bolt contract.

Required before live use:
1. Obtain the exact documented request schema and pagination/completeness fields for the enabled Bolt Fleet Integration endpoints, or a provider-approved non-production fixture.
2. Implement the confirmed pagination loop with a hard upper bound, duplicate-page detection, and explicit failure when completeness cannot be proven.
3. Retry only transient errors under a bounded policy; do not retry authentication/authorization failures with alternate request shapes.
4. Add mocked tests for multiple pages, empty final page, repeated cursor/page, malformed envelope, HTTP 401/403, HTTP 429, HTTP 5xx, and HTTP 200 with application-level failure.
5. Keep the sync in dry-run/preflight mode until the full payload is proven complete.

This is a source-code finding, not evidence that the current Bolt account returns more than 1000 records or uses any particular pagination format. No Bolt API request was made.
