# CarTrack Edge Function — security validation and release checklist

## Purpose

Validate the `cartrack-sync` Edge Function candidate before any production deployment. This checklist is intentionally separate from the multi-company redesign and does not authorize a production invocation or deployment.

## Candidate code facts

The current PR branch contains these controls (some are inherited from its base branch, not introduced by the error-redaction commit itself):

- Rejects browser origins other than `https://fleet.simplicity2take.com`.
- Accepts POST only (plus CORS preflight OPTIONS).
- Requires a Bearer token and validates it with `callerClient.auth.getUser()`.
- Uses the verified user ID to read `profiles.role,status` with the service client.
- Requires `role = admin` and `status = Ativo` before calling the CarTrack API or privileged RPC.
- Does not return provider response bodies or PostgREST/SQL error messages to the caller.
- Returns a generic HTTP 500 response for unexpected failures.

CORS is a browser control, not an authorization boundary. The authorization checks above remain mandatory for every caller, including non-browser clients.

## Required isolated tests

Run against a disposable/staging Supabase project and mocked CarTrack HTTP endpoints. Do not use the production Edge Function, production CarTrack credentials, or production data for these tests.

| Case | Request / fixture | Expected result |
|---|---|---|
| Missing Authorization | POST without Bearer header | 401; no CarTrack request; no RPC |
| Invalid/expired JWT | POST with invalid or expired token | 401; no CarTrack request; no RPC |
| Authenticated non-admin | Valid user with role other than admin | 403; no CarTrack request; no RPC |
| Inactive admin | Valid admin profile with status other than Ativo | 403; no CarTrack request; no RPC |
| Missing profile | Valid user with no profile row | 403; no CarTrack request; no RPC |
| Profile lookup failure | Force profile query error | Generic 500; no CarTrack request; no RPC |
| Active global admin | Valid active admin | CarTrack requests and RPC called once, in order |
| Disallowed Origin | Browser request from another origin | 403; no CarTrack request; no RPC |
| OPTIONS preflight | Allowed origin, OPTIONS | 204 with the configured CORS headers; no CarTrack request; no RPC |
| Wrong method | GET/PUT | 405; no CarTrack request; no RPC |
| Provider failure | Mock 4xx/5xx with a body containing a fake secret | Non-2xx; response excludes the fake secret and raw body |
| RPC failure | Mock PostgREST error containing fake SQL/schema details | HTTP 500; response excludes those details |
| Unexpected exception | Throw an error containing a fake credential | HTTP 500; response excludes the fake credential |

For the active-admin test, assert the exact call count and verify the authorization check completes before either external fetch or privileged RPC. Use synthetic users, credentials, registrations, and payloads only.

## Release gates

- [ ] Deno type-check and lint pass in the project's supported CI/runtime.
- [ ] All isolated tests above pass.
- [ ] Confirm the deployed artifact is built from the reviewed commit, not merely that a PR is open or merged.
- [ ] Confirm deployed `verify_jwt` configuration and retain the in-function `getUser()` plus active-admin check.
- [ ] Confirm no secrets, provider bodies, SQL details, or raw exception objects are returned or logged.
- [ ] Record the deployment version and perform a controlled post-deploy check with an approved administrator.
- [ ] Keep multi-company CarTrack credentials, mapping, and tenant-scoped reads/writes out of this release.

## Explicit non-goals

This release does not solve CarTrack multi-account isolation, account-scoped vehicle mapping, pagination/completeness, provider payload minimization, odometer monotonicity, snapshot idempotency, or transaction/concurrency safety. Those remain separate engineering work and must be validated before multi-company synchronization is enabled.

## Current operational boundary

No production function invocation, sync, migration, secret change, or deployment is part of this checklist. Production changes require a separate explicit approval after the release gates are satisfied.
