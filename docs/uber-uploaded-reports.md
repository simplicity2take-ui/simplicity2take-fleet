# Uploaded Uber trip reports

`scripts/uber-trip-report.cjs` prepares original user-uploaded Uber CSV reports for execution through the authorized Supabase connector. It does not call a network service, read credentials, modify a source file, update driver/vehicle records or expose a browser endpoint.

## Source and preparation

Use only current Library metadata for original uploaded CSVs belonging to SIMPLICITY2TAKE. Exclude generated/combined reports. The scheduled workflow starts with uploads created on or after 12 November 2026; older archives are not automatically backfilled. A report date or an upload timestamp does not certify platform coverage. Download through the current Library helpers, preserving its Library/file/version identity. Keep source bytes unchanged.

Read a current, completely paginated snapshot of `drivers(id,uber_driver_uuid)` and `vehicles(id,plate,uber_vehicle_uuid)` through Supabase. Do not use names, current assignments or offline/blocked status to substitute an unknown UUID. Historical trips may belong to an inactive driver; importing them never reactivates that account.

Prepare the report in a private working directory using the existing Node runtime:

```js
const fs = require('node:fs');
const {prepareReport, buildInsertSql} = require('./uber-trip-report.cjs');
const prepared = prepareReport(fs.readFileSync(csvPath), {
  drivers, vehicles,
  source: {original_upload: true, library_file_id, file_id, file_name}
});
// Retain the whitelisted prepared JSON and provenance privately for verification.
const sql = buildInsertSql(prepared);
```

Limits are 10 MiB and 5,000 source rows per report. The parser validates quoting, headers, UUID uniqueness, exact plates, source timestamps and numeric distance. It discards addresses, contacts and irrelevant columns. Lisbon local times must have one valid interpretation; nonexistent/ambiguous DST times remain rejected. Explicit offsets are preserved as instants. A request time never becomes acceptance/pickup; missing times never become the current clock. Cancellations without vehicle identification may retain a null vehicle. Conflicting duplicate trip IDs are withheld, including an invalid first occurrence. No kilometer value is inferred from the trip distance.

## Conditional write and receipts

Execute the generated SQL only through the authorized Supabase connector. One statement revalidates identities, inserts missing trip IDs with `ON CONFLICT DO NOTHING`, and records `uber_library_trip_report_imported` in `audit_log`. Existing trips are never overwritten; inconsistent existing identity/source values are counted for review. Driver/vehicle UUIDs, statuses, payments, documents and assignments are not updated.

Receipt fields include the original byte hash, Library/file reference, mapping fingerprint, source/prepared/rejected counts, inserted count, live identity rejections and existing conflicts. Verify the actual inserted IDs/source fields and the receipt after execution. `all_rows_accounted=true` means the source file's prepared rows are accounted for, not complete Uber/Bolt coverage; `coverage_verified` remains false. A repeated completely accounted byte hash performs no additional writes. Pending files may be retried when their relevant mappings or source version change; unchanged failures must not create repeated audit entries or alerts. A newly uploaded copy of a known hash may receive one separate duplicate receipt keyed to its immutable file reference, without importing trips again.

Only successful import receipts and verified duplicate receipts may be used to skip an already seen file/version. Vehicle-UUID association audits alone are not import receipts. Check unknown/new report versions rather than assuming the same filename, size or date means identical bytes.

## Validation

Eight isolated parser/SQL tests cover original-byte hashes, data minimization, CSV errors, DST, exact identities, vehicle-less cancellations, conflicting duplicates, missing/reversed/future timestamps, SQL quoting, idempotency, identity changes after preparation and preservation of existing trips/inactive accounts. The full local regression suite passed 63 tests.

A real, already imported 152-row report was prepared with current identities and executed through Supabase: zero inserts, zero live identity rejections, zero existing conflicts, all file rows accounted for. A second execution created no additional audit or trip rows. This does not establish future scheduled execution or 28-day coverage.
