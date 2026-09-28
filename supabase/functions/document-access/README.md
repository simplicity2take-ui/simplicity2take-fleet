# Document Access — Supabase Edge Function

This function is the server-side gateway for portal document access.

## Rules

- Drivers must never receive a public Google Drive URL.
- The function must authenticate the Supabase user and query the document through RLS.
- A document with `driver_id` set is private to that driver (plus admin).
- A vehicle document can be visible to drivers currently assigned to that vehicle.
- Google Drive files should remain non-public.
- The function should return the file through a private, non-cacheable response.

## Required Supabase secret

`GOOGLE_SERVICE_ACCOUNT_JSON`

The value is the complete Google service-account JSON credential. Never commit it to GitHub.

## Google Drive permission

The service account only needs the minimum Drive permission required by the deployed functions. For reading existing documents, use Drive read-only access where possible.

## Deployment

This source is intentionally stored in GitHub first. It is not deployed to Supabase automatically.

Before production deployment, verify:
1. the live database schema matches the migration;
2. the access-control migration has been executed;
3. the Edge Function is deployed;
4. `GOOGLE_SERVICE_ACCOUNT_JSON` is configured as a Supabase secret;
5. Drive folders/files are private;
6. a driver cannot open another driver's contract, even when both drivers use the same vehicle.
