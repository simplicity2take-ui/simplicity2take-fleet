# Cartrack ignition history

Read-only proxy for the documented `/trips` API. Uses the existing server-side Cartrack credentials; credentials and location coordinates are never returned to the browser.

Authentication is checked inside the function: an active administrator JWT, or the existing scoped server job key. Anonymous users and drivers cannot access this endpoint. Keep `verify_jwt=false` because the handler validates both supported authentication methods itself.

Accepts UTC ISO `start`, `end` (maximum 31 days) and `page` (1–100). Converts request dates to the Cartrack API's required UTC `YYYY-MM-DD HH:MM:SS` format. Returns only trip ID, registration, timestamps and duration, plus pagination metadata. Private trips remain excluded. No records are written or deleted.

The admin Utilisation page fetches history on demand, up to ten pages, clearly marks incomplete results, displays explicit-offset timestamps in Europe/Lisbon with seconds and preserves full interval duration across period boundaries. An open interval does not establish the current ignition state. Missing intervals do not prove ignition was off.

Validation: `node tests/cartrack-history-security.test.cjs` (Node 24), `node tests/cartrack-history-ui.test.cjs`, `node tests/cartrack-ignition.test.cjs`. Live authenticated test returned 154 intervals across 20 vehicles; anonymous request returned 401. The current-status scheduled sync is unchanged.

Daily and per-vehicle period totals include only closed intervals clipped to the query range. Overlapping intervals are merged per registration, then split at Europe/Lisbon midnights using the same reporting calendar as the rest of the portal. Missing ends/invalid dates are excluded and totals marked partial. No returned intervals means unknown rather than zero. DST tests cover both 23-hour and 25-hour days.

The optional specific-day selector queries local midnight to the next local midnight, clipped to the current second for today. Future and invalid calendar dates are rejected before calling the API. Switching a preset period clears the specific-day override. Date and registration fields are disabled during a pending query.
