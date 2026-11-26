# Uber import authorization and traceability

Only POST requests from an authenticated, active administrator profile may reach CSV processing or privileged writes. Authorization uses the server profile record, never editable user metadata or client-supplied roles. Missing, inactive, driver or failed profile lookups fail closed. Gateway JWT validation remains enabled.

Preview is supported only for status and trip reports. Asking for preview on another report is rejected before reading or writing its rows. Non-status/non-trip reports require a valid declared date interval, with actual calendar dates and start no later than end. A provided interval is validated for all report types.

Actual import attempts emit structured Supabase function log events: started, then succeeded or failed, with a request UUID, authenticated actor UUID, report type, declared interval, SHA-256 of the input, received/response row counts, timestamps and HTTP status. CSV contents, contact fields, credentials and raw error text are excluded. Previews do not emit an import-success event.

These logs are subject to existing platform retention. They are not permanent database audit rows: the current service role has no INSERT privilege on audit_log, and this change does not broaden it. No new table, grant, secret, paid service or schedule is introduced.

Every trace keeps coverage_verified=false. Neither a successful upload, a filename interval, a source hash nor the earliest/latest trip proves a complete export. Logs cannot alone authorize driver inactivity. Confirmed identities, complete source scope and successful coverage of both platforms remain required. No existing trips, lifecycle states, assignments or historical dates are changed by installing this handler.

For individual trip reports, internal driver links now require one unambiguous exact Uber driver UUID. Display names never select a driver. Internal vehicle links require the report UUID and normalized plate to identify the same unique vehicle; a partial or conflicting match remains unlinked and visible in the preview counts. This prevents a plausible name or plate from silently assigning a trip to the wrong fleet record.

The write path inserts only trip IDs that were absent during the preflight lookup and uses conflict-ignore semantics as a final concurrency guard. Reimporting the same file therefore performs no second trip write and never overwrites the driver, vehicle, status, times or distance of an existing trip. The response reports existing rows separately from newly saved rows.

Regression: tests/uber-import-authorization.test.cjs exercises authorization before body access, invalid periods, preview behavior, successful and failed writes, malformed input, trace correlation and exclusion of private CSV content. Tests mock all network writes. Rollback source is the handler in main commit 980d72c38a9ba262b4621efc22278443982b1ec8, verified identical to installed version 23 before this change.
