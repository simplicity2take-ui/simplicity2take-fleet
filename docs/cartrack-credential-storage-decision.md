# CarTrack credential storage decision record

**Status: proposal only — no secrets, schema, Edge Function or production configuration changed.**

Date: 30 October 2026

## Decision summary

Keep the existing single CarTrack credential pair in Supabase Edge Function secrets for the current single-account S2T integration. Do not pretend this is multi-company support and do not accept account credentials or a secret reference from the browser.

For a future multi-company rollout that must avoid a new paid vendor, evaluate **Supabase Vault** as the first option, subject to confirming that the Vault extension is enabled/available on this project and validating its privilege model in a disposable database. Store an opaque Vault secret UUID in the account registry; never store the CarTrack username/password in `public`, `app_settings`, logs, client responses or Git.

Vault is encrypted at rest, but the decrypted view is sensitive: any role with access to it can read plaintext secrets. Therefore Vault alone is not the security boundary. The access path must be a narrowly scoped server-only function and a service-side Edge Function. If those controls cannot be proven in isolated tests, retain one-account environment secrets and block multi-account enablement.

## Options considered

| Option | Benefits | Risks / limitations | Decision |
|---|---|---|---|
| Existing Edge Function environment secrets | Supported by Supabase; server-only; simple rotation; no database secret table | Current implementation supports one credential pair; multiple named env vars do not provide a scalable tenant authorization model | Keep for the current one-account integration |
| Supabase Vault + opaque secret reference | Encrypted at rest; secret can be resolved server-side; avoids adding a separate vendor | Decrypted view must be tightly protected; requires careful private-schema RPC design, grants, audit and disposable-DB tests; project extension availability must be checked | Preferred candidate for a no-new-vendor multi-account design, not approved for implementation yet |
| External secret manager | Strong separation and mature rotation/access controls | Likely introduces a separate service, credentials, operational burden and potentially cost | Do not adopt while the requirement is zero additional cost |
| Plaintext credentials in public tables / app_settings / browser config | Easy to implement | Exposes credentials to Data API, frontend, exports, logs or overbroad roles | Rejected |

## Required Vault access pattern if approved

1. Enable/confirm the Supabase Vault extension in a disposable database first; do not enable it in production as part of this review.
2. Create one Vault secret per provider account (or one JSON secret containing that account's username/password). Use a random opaque secret UUID as the reference.
3. Store only that UUID in a server-managed account registry. The public-facing application must never be able to create, change, enumerate or resolve secret references.
4. Keep Vault objects and any secret-resolving function outside exposed schemas. Do not grant `anon` or `authenticated` access to `vault.decrypted_secrets`.
5. If an RPC is necessary, use a private schema, explicit service-role-only EXECUTE, `SECURITY DEFINER` only if unavoidable, an empty `search_path`, fully qualified object names, and an explicit service-role assertion. Return only the one requested account's credential material; never return all secrets.
6. The Edge Function must independently authenticate the caller and authorize the requested company/account from trusted database state. Never trust a browser-supplied company ID, account ID, secret UUID or provider-account identifier as authorization.
7. Resolve one account's credentials, call CarTrack, validate pagination/completeness, map provider vehicle IDs to canonical Fleet UUIDs within that company, and write via one tenant-validating transaction/RPC.
8. Redact all credentials, Authorization headers, provider response bodies, raw payloads and SQL errors from logs and client responses.
9. Rotate credentials by creating/updating the Vault secret and updating the opaque reference if necessary. Provide a disable/revoke path and audit who changed account status; do not log secret values.
10. Prove isolation with separate authenticated Company A and Company B sessions and synthetic credentials. A service-role test alone does not prove RLS.

**Important:** Supabase documentation confirms that Vault stores secrets encrypted at rest but exposes decrypted values through `vault.decrypted_secrets`; access to that view must be restricted. Supabase Edge Function secrets are available to server-side functions as environment variables. Sources: [Vault documentation](https://supabase.com/docs/guides/database/vault) and [Edge Function secrets documentation](https://supabase.com/docs/guides/functions/secrets).

## Account registry constraints

The future account table should contain only non-secret metadata:

- `id` — UUID primary key.
- `company_id` — tenant owner, FK to the canonical companies table.
- `provider_account_key` — stable non-secret account identifier.
- `credential_ref` — opaque secret reference only; never a username/password.
- `status` — pending, active, suspended or revoked.
- `created_at`, `updated_at`, and optional rotation/audit metadata.

Constraints and authorization requirements:

- Unique account key within a company.
- No client INSERT/UPDATE/DELETE on account or secret-reference records.
- Global administrator or a narrowly authorized integration-management role may administer account metadata, but company admins must not be able to point an account at another company's secret.
- The Edge Function resolves the account from trusted server-side context; do not accept arbitrary secret references in request JSON.
- Every mapping must resolve to one canonical Fleet vehicle whose `company_id` equals the account's `company_id`.
- Service-role code must explicitly validate tenant ownership because service_role bypasses RLS.

## Required tests before implementation

- Vault extension availability and version are confirmed without changing production.
- `anon` and `authenticated` cannot SELECT `vault.decrypted_secrets` or invoke the resolver.
- Service-role resolver can retrieve only the requested active account secret.
- A suspended/revoked account cannot resolve credentials or sync.
- Company A cannot request or infer Company B's credential reference.
- Invalid, missing and cross-company references fail closed.
- Secret values, Basic Authorization headers and provider error bodies never appear in logs or HTTP responses.
- Credential rotation takes effect without exposing the prior value.
- Concurrent syncs for separate accounts cannot mix credentials, provider IDs, mappings or snapshots.
- Synthetic Company A/B data proves tenant isolation using separate authenticated sessions.
- Failure halfway through a sync leaves no partial writes.

## Explicit blockers

- No disposable Supabase database is currently available without provisioning a potentially billable branch/project. Do not create one.
- Vault extension availability and exact grants have not been inspected in an isolated database.
- CarTrack's provider account identity, pagination and completeness contract still require confirmation.
- The existing 23 CarTrack rows (21 registration candidates, 2 unmatched) have not been assigned to an account or canonical vehicle. No backfill is approved.
- No migration, RPC, Edge Function code, production secret, privilege or live sync is changed by this proposal.

## Current repository caller review

A source review of the default-branch `app.js` found direct frontend reads of `cartrack_vehicles` and `cartrack_vehicle_snapshots` (the current UI uses these tables directly). No call to `get_cartrack_fleet_data()` was found in that file. This is not a complete repository-wide proof: search every branch, module, SQL function, dashboard/report and external client before revoking or changing that RPC. Do not change its grants based only on the `app.js` inspection.

## Release gate

Multi-company CarTrack remains **BLOCKED** until the credential store is approved, tenant mapping is implemented, direct table reads are company-scoped, the RPC validates ownership transactionally, and the tests above pass in a disposable environment. Production changes, deployment and live synchronization require separate explicit approval.


## Production catalog checks (read-only, 30 October 2026)

A further SELECT-only catalog inspection confirmed:

- Supabase Vault is already installed as extension `supabase_vault` version `0.3.1`, and the `vault` schema exists.
- The `vault` schema grants USAGE to `service_role` and `postgres`; it does not grant USAGE to `anon` or `authenticated`.
- `vault.decrypted_secrets` grants SELECT to `service_role` and `postgres`; it does not grant SELECT to `anon` or `authenticated`.
- Therefore, Vault is present and the public client roles do not currently have direct schema/view access. However, the service role can read decrypted secrets. Any Edge Function using the service-role key is consequently part of the trusted secret-handling boundary and must be reviewed as privileged code.
- `public.get_cartrack_fleet_data()` is owned by `postgres`, is SECURITY DEFINER, uses `search_path=public`, and has EXECUTE grants to `authenticated` and `postgres`. Its body returns complete JSON rows from both CarTrack tables and applies `public.s2t_is_admin()`.
- The catalog dependency query found no registered routine-to-routine dependency on `get_cartrack_fleet_data()`. This does not rule out dynamic SQL, frontend calls, external clients or dependencies not tracked by `pg_depend`; do not revoke or change grants on that basis alone.
- No grant, function, extension, secret or production setting was changed.

**Implication:** Supabase Vault is a realistic no-new-vendor candidate, but the existing service-role access to decrypted secrets makes least-privilege controls and Edge Function review mandatory. The credential resolver must not become a broadly callable public RPC, and the application must never receive decrypted credentials.
