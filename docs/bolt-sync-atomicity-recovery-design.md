# Bolt sync atomicity and recovery design

Status: design only. This document does not change database schema, invoke Bolt, or write production data.

## Problem

The current `bolt-sync` Edge Function writes vehicles first, then drivers and assignment rows. Each Supabase request commits independently. If a later write fails, earlier writes can remain even though the endpoint returns an error. A retry may be safe for some rows but is not proven to be safe for all identity fallbacks or assignment edge cases.

## Recommended boundary

Use a two-phase flow with a clear commit boundary:

1. **Fetch and validate outside the database transaction.**
   - Fetch Bolt driver and vehicle payloads.
   - Confirm the endpoint response is successful at both HTTP and application level.
   - Validate required identities and duplicate UUID/email/phone/registration fields.
   - Validate pagination completeness using the confirmed Bolt contract. Never infer completeness from HTTP 200 alone.
   - Build a normalized payload and a deterministic sync/request identifier.
2. **Apply the normalized payload atomically inside PostgreSQL.**
   - Call one narrowly scoped database RPC for the apply phase.
   - The RPC validates the caller/company scope from trusted server-side context; it must not trust a company ID supplied by the browser.
   - All driver, vehicle and assignment changes for that payload happen in the same transaction. Any exception rolls back the entire apply phase.
   - Keep assignment history: do not delete active assignments to make the import match Bolt. Preserve existing assignments and return explicit conflict records/counts.
   - Use unique constraints/upsert keys where supported; use a sync identifier to make safe retries idempotent.
3. **Record outcome.**
   - Return counts for created, updated, unchanged and conflicts.
   - Record a minimal audit entry (sync identifier, company, timestamp, counts, result); never log secrets or full driver payloads.
   - A failed apply phase must leave no partial changes from that phase.

## Important distinction

This makes the **database apply phase** atomic; it cannot make the external Bolt API call part of the PostgreSQL transaction. The fetched payload should be validated and staged before the transaction. If durable staging is used, its lifecycle, retention, access controls and cleanup must be designed separately.

## RPC security requirements

- Keep the RPC unavailable to `anon` and ordinary browser roles unless a reviewed authorization design explicitly permits them.
- If the Edge Function uses the service role, enforce authorization in the Edge Function and validate company scope again in the RPC using a trusted server-side value. Do not assume RLS protects service-role queries.
- Do not use a hard-coded administrator email as the long-term authorization model.
- Avoid a broadly callable `SECURITY DEFINER` function. If elevated privileges are genuinely required, use a non-exposed schema, a fixed safe `search_path`, narrow grants, and explicit authorization checks.
- Company scoping depends on the draft company foundation and membership model; do not implement against an assumed schema before those migrations are reviewed and tested in an isolated database.

## Concurrency and identity rules

- Two simultaneous syncs must not create duplicate driver/vehicle records or overlapping active assignments. Use database constraints and transaction-level locking appropriate to the confirmed schema.
- Match by Bolt UUID first. Fallback identity matches must detect ambiguity; never select an arbitrary row if multiple records match.
- Normalize phone numbers and registration numbers consistently in both preflight validation and database matching.
- A driver or vehicle without a usable identity fails validation before the apply phase.
- A vehicle assignment is created only when no active assignment exists. A different or multiple active assignment is reported as a conflict and left unchanged.

## Failure-injection tests required

Run only against a disposable, isolated Supabase project with mocked Bolt payloads:

1. Invalid/duplicate payload: no database changes.
2. Failure after the first vehicle operation: all apply-phase writes roll back.
3. Failure after the first driver operation: all apply-phase writes roll back.
4. Failure while creating an assignment: all apply-phase writes roll back.
5. Retry the same sync identifier: no duplicate records or assignments.
6. Two concurrent identical syncs: no duplicates and no overlapping active assignments.
7. Cross-company driver/vehicle input: rejected.
8. Caller without the required authorization: rejected before writes.
9. Error/log output contains no access token, client secret or full sensitive payload.

## Current error-handling gap

The current Edge Function catch block logs the raw caught error and returns its message to the caller. Supabase/PostgREST errors can contain internal schema, constraint, or query details; other upstream errors may contain provider-specific diagnostics. This is not a safe long-term boundary.

Before live use:
- Return a stable, user-safe error code/message to the browser; do not return arbitrary database/provider exception text.
- Log only a correlation/sync identifier, operation stage, and a classified error code. Do not log credentials, access tokens, full upstream responses, driver records, or raw database errors.
- Preserve useful operator diagnostics in a controlled server-side channel with access restrictions and retention rules, after explicit redaction.
- Add tests proving that simulated database errors, upstream error bodies, access tokens, and client secrets do not appear in HTTP responses or ordinary logs.

## Release gate

Do not deploy or run a real sync until:
- the exact Bolt endpoint, response envelope, pagination fields and completeness indicators are confirmed from authenticated documentation or an approved non-production fixture;
- the company ownership/membership migrations are reviewed and tested in isolation;
- the transactional apply RPC and least-privilege grants are implemented and reviewed;
- all failure-injection, retry, concurrency and cross-company tests pass;
- a controlled live-sync plan includes a backup, dry-run counts and post-sync reconciliation;
- the user explicitly authorizes the deployment/live sync operation.

## Current status

The pure Deno type-check and unit tests pass for the tested commit. They do not establish database atomicity, tenant isolation, API pagination completeness or live-sync correctness. No production deployment or sync is authorized by this design.
