# Read-only Bolt online driver/vehicle query

Uses the documented Bolt Fleet API v2 `getOnlineDrivers` endpoint for the existing company ID 9360, with the existing server-side Bolt credentials. No database records, assignments, scheduler jobs or vehicle statuses are written.

Authorization is verified inside the handler using Supabase `auth.getUser`, followed by an active administrator profile check. Deploy with `verify_jwt=false` because the handler performs this authorization itself. No anonymous calls, driver calls or scheduler keys are accepted. No tokens or credentials are returned or logged. Return fields exclude coordinates, addresses, passenger/order data, email and phone.

The response is a point-in-time observation of an online driver and their selected vehicle. `stateChangedAt` belongs to the Bolt driver state and must never be used as the vehicle-switch time. This endpoint does not reconstruct prior online history or prove movement. Empty online results do not imply the driver was offline throughout a day.

HTTP-200 Bolt responses with nonzero API codes are failures, including missing company/endpoint permissions; the frontend shows an error instead of zero online drivers. No further sync endpoint is invoked.

Official API specification: https://developer.bolt.eu/fleet-integration

Tests: `node tests/bolt-online-read.test.cjs` (Node 24) and `node tests/bolt-online-ui.test.cjs`.

Live account check on 10 November 2026 reached the OAuth token request but authentication was refused, so no online driver/vehicle data was returned. A small allowlist of OAuth error names and HTTP status is exposed for diagnosis; descriptions and credential values are excluded. API availability for this account remains unconfirmed until authentication succeeds.

The completed live diagnostic returned HTTP 500 from the Bolt OAuth token service (`BOLT_TOKEN_FAILED_HTTP_500`). This is not proof of invalid credentials or offline drivers. No online driver data was received and no authentication success is claimed. No further live retries were attempted after diagnosis.

Configuration mode (`mode: configuration`, six-character `expectedClientIdSuffix`) compares only a caller-supplied public client-ID suffix with the configured ID and returns match/configured booleans. It makes no request to Bolt, never returns ID/secret values and does not validate the full ID or secret. The normal administrator authorization applies. This helps distinguish a stale configured client from the active key visible in the portal without repeating authentication calls.
