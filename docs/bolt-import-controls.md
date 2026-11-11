# Bolt import controls

The activity import retains the existing administrator-email restriction and additionally requires an active administrator profile read from the database. Missing/inactive/driver profiles and failed lookups are rejected before reading request input, requesting a Bolt token or writing. Only POST and OPTIONS are accepted; JWT verification remains enabled.

All ride pages are received before the existing database synchronization call. The importer rejects changing totals, malformed totals, repeated or missing order references, oversized pages, totals smaller than the received count, premature empty pages and exhaustion of the 100-page bound. Failures before persistence do not call the save function. The company remains fixed to 9360, with the existing maximum 31-day query range.

Request-local structured events record started/succeeded/failed, a request UUID, actor UUID, requested interval, received row count, expected total, page count, whether persistence was attempted and timestamps. Logs exclude raw ride data, contacts, tokens and upstream error details. They use the existing Supabase log retention; no new storage, grants or schedule is introduced.

`api_pagination_complete=true` means only that the checked pages satisfied the API counts. An API without a snapshot cursor may change during pagination even with a stable total. Therefore `snapshot_consistency_unverified=true` and `coverage_verified=false` remain explicit. These traces alone cannot authorize the 28-day inactivity rule or establish absence of trips. Failed API or persistence requests are never reported as successful imports.

Tests mock all external/database writes and cover authorization before OAuth/input access, multipage success, duplicate/missing references, changing totals, inconsistent counts, empty history, page-cap exhaustion, write failures, fixed company and trace minimization. No live trip import is performed as a test.

The pre-change source was read from installed version 11 and confirmed identical to the repository at c9c46d5033296d887b2f769c5da928e329f0d819. That revision is the rollback source. Existing data, lifecycle states, vehicle assignments and historical timestamps are preserved.
