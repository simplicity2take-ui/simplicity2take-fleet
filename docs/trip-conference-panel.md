# Driver and vehicle activity conference

This change adds a read-only activity conference to the administrator portal. The touched root frontend files were compared with the current main tree `fa78fb4e278ae01cdca425767b12c8714b7e403f` before editing; unrelated synchronization changes are outside this patch.

The administrator's Utilização view adds Conferência, with a Lisbon calendar day and driver/plate search. It combines received completed Uber and Bolt services by confirmed driver and vehicle, compares their available times with complete form/native declarations, and indicates whether the exact plate is present in the synchronized Cartrack roster. No fixed vehicle assignment is required.

First/last service records are activity observations, not clock-in/out times. A service without accepted/pickup time remains visibly missing its start, even if its finish is compatible with a declaration. Refusals, cancellations, unanswered requests and failed services are excluded from completed-service totals. A declaration without a compatible service or a service without a declaration does not establish an error or absence. This panel does not compute mileage; the existing Cartrack-only turn consultation remains separate.

Identity uses confirmed IDs, UUIDs and normalized exact plates. Contradictory identities and ambiguous UUIDs are withheld. All five datasets are paginated with an exact count, stable ordering and a 5,000-row limit per dataset. Missing/changing totals, duplicates and the cap cause a partial result; partial results never validate declarations. Receiving all database pages does not certify complete platform imports.

The day query selects records with an accepted, pickup, dropoff, finished or observed timestamp in that Lisbon day. Completed services must also have an actual service timestamp in the day; an import observation cannot move an old service into today's activity. A service spanning the entire day with no service timestamp inside it is outside this dated-record view. Midnight-crossing declarations are read with two days of padding on either side; missing older boundaries remain unconfirmed. Test shifts, administrative closures, source-change flags, open/invalid declarations and conflicts between native/form declarations cannot validate operational activity.

The controller permits reads for an administrator only, relies on existing database RLS, escapes displayed text, and clears cached and pending results on logout/account change. It calls no insert/update/delete/RPC/Edge Function. No schema, authorization policy, driver status, document, payment, assignment, shift or original import record is changed. The existing driver-only restriction in `/teste/` is preserved.

## Verification

- `node --check app.js`, `node --check teste/app.js`, and both new modules.
- `node --test tests/*.test.cjs`: 53 checks passed, including identity contradictions, cross-source declarations, missing service starts, cancelled requests, midnight pairs, source-change flags, partial pagination/caps, HTML escaping and late responses after logout/account change.
- Read-only validation against a current connector snapshot: 10 November returned 298 services in 21 combinations; 11 November returned 235 in 17; 12 November returned 6 in 2. No identity/time-order conflicts were found in those selected records. These are dated-record views, not certified daily totals. No source records were written.
- The real app factory, delegated conference-button handler, activity renderer and sign-out handler are exercised together with a read-only simulated client in both app paths. These tests cover plate search, the 25-hour Lisbon DST day, forged driver clicks and pending responses after sign-out; they do not run a browser or claim visual acceptance.
- Database permission validation used read-only transactions under the existing active administrator and driver identities with `SET LOCAL ROLE authenticated`, then rolled back. The administrator could read 29 drivers, 28 vehicles, 4,279 trip records and 7,718 form declarations; the driver saw zero other-driver trips and zero admin-only form declarations. The native-session table was empty, so its live counts do not independently establish row isolation (the isolated database regression covers that). The connector returned to its original role with no subject after the tests. This is database-policy validation, not an interactive portal login.
- Root and test copies of both new modules match; their scripts load before the app. Existing regression test context was extended for the new read-only panel.

Visual/mobile browser acceptance and live authenticated administrator UI acceptance are still pending. Earlier browser attempts in this environment were blocked; no policy workaround or further browser retry was attempted. Source/VM tests and connector snapshots do not establish that those acceptance tests passed.

The release must include both new modules in the root and `/teste/` paths together with their app/index changes. No backend migration or deployment is needed for this panel.
