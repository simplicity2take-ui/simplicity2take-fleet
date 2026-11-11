# Driver shift clock and automatic checks

The driver signs in with their existing account, opens the vehicle QR and starts or ends their own shift. There is no driver/vehicle selector that can substitute another person's identity. Fixed vehicle assignments are not required. QR lookup returns only a safe vehicle summary and does not extend document permissions. Times come from the database server. Failed/offline requests are not presented as locally saved shifts. If the current-state read fails, the screen says the turn is unconfirmed and blocks a new start. An unsuccessful QR lookup clears the previous selection.

`driver_shift_sessions` is separate from the existing Google form import. RLS allows active drivers to read their own rows, and active administrators to read all. Drivers cannot directly insert/update/delete rows. Public invoker RPCs delegate to tightly granted private functions that validate `auth.uid()`, active profile and driver, lock rows, enforce one open shift per driver/vehicle and support idempotent request IDs. No `vehicle_assignments`, legacy events, contacts, documents or lifecycle statuses are changed.

## Installation after review and approval

1. Review/install `supabase/sql/native-driver-shifts.sql` in the S2T project. This is additive and must run once.
2. Deploy `supabase/functions/shift-review/index.ts` with its two local JS dependencies. Keep gateway `verify_jwt=false`: the handler requires and verifies the existing scoped `x-cartrack-sync-key` before reading data. Browser/anonymous calls are denied. No new secret or external account is needed.
3. Install `supabase/sql/native-shift-review-scheduler.sql` only after the endpoint is deployed. This creates a separate 15-minute job using the existing key in Vault and does not change the existing Cartrack schedule.
4. Publish the changed static portal files together, including the new JS modules and manifest. Root and `/teste/` share the same logic.
5. Run an authenticated driver acceptance test with a designated test account/vehicle before rollout. No synthetic shift rows have been written to the production project by this change.

The review job processes up to ten due rows per run with a time budget. A closed shift is queued immediately; open shifts are checked again at the 18-hour warning boundary. Unavailable data is retried; already checked rows are revisited daily for seven days to catch delayed imports. Queue load and upstream availability can delay the result. No turn is auto-closed or repaired. An active administrator may explicitly release an open session with an 8–500-character reason. The server stores the actor, reason and current administrative closure time, preserves the original start, marks it for review and withholds mileage because that time is not proof of the actual exit. Drivers cannot invoke this administrative action, including when the original driver account is now inactive.

Uber/Bolt checks use confirmed IDs/UUIDs and actual trip timestamps: mismatched vehicles/drivers, services crossing shift boundaries and partial/undated data are flagged. Received trips do not prove complete import coverage. Results explicitly retain `platform_coverage_unconfirmed`; no-trips is pending, not an assertion of zero work. The worker does not change the inactivity rule or Rúben Peres exemption.

Mileage comes exclusively from authenticated Cartrack history, with complete pagination required. The nearest odometer readings within 15 minutes of the server entry/exit are used. Reading times and offsets are retained and displayed; this is a difference between nearby readings, not an exact measurement of the submission instants. Missing, conflicting, reversed or partial history stays pending. Closed shifts over 36 hours are flagged and withheld from mileage calculation. No form-supplied km, platform distance or estimates are substituted. A temporary upstream failure or incomplete pagination does not erase an earlier verified Cartrack result for the unchanged shift: the UI labels it as previous readings with a pending refresh, and a retry is queued. Contradictory readings still require review. Conditional metadata writes return the affected row ID; stale/no-op writes count as skipped rather than reviewed.

## Validation

```sh
npm ci --prefix tools/driver-lifecycle-tests
node --test tests/*.test.cjs
node tests/native-shifts-db.mjs
```

The database test uses synthetic profiles, roles and tables in in-memory PostgreSQL (PGlite); it covers RLS, unauthorized/direct writes, exclusive open shifts, server times, idempotency, handover and inactive accounts. Worker/UI tests use fake data and block real external writes.

`tests/native-shifts-browser.cjs` is an additional mobile integration test using Playwright and mocked Supabase calls. Run against a local static server, with Playwright available (optional `FLEET_PLAYWRIGHT_MODULE`, `FLEET_CHROMIUM_PATH`, `FLEET_TEST_URL`). It has not passed in this executor: local Chromium cannot create its process socket (Operation not permitted). A subsequent shared-browser attempt also rejected the local file preview under its URL policy; no browser-policy workaround was attempted. Visual/mobile and real Supabase acceptance tests remain required before rollout.

If rolling back, revert the frontend and unschedule `s2t-native-shift-review`; preserve all recorded shift rows. Do not drop tables or delete history.
