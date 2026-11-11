# Restricted driver-shift pilot

This release targets `/teste/` only. The main `app.js`, `index.html`, `styles.css`, existing document permissions, Google events, driver lifecycle and vehicle assignments are unchanged. New root JS files are unused libraries for isolated tests and are not loaded by the main page.

The first participant must use the owner's verified existing active driver account. No account, credential or access setting has been changed in production. Additional driver accounts must be handled separately; do not create accounts or infer credentials as part of this pilot.

## Approval and installation

After explicit approval, install `supabase/sql/native-driver-shifts.sql`, deploy `supabase/functions/shift-review` with its two JS dependencies (verify_jwt=false; the handler verifies the existing scoped job key), and install `supabase/sql/native-shift-review-scheduler.sql`. The new allowlist is initially empty and denies new starts/lookups by default.

Reverify the participant's driver/profile association, then enable only that confirmed driver ID in `fleet_private.shift_access`, with `enabled=true,test_mode=true`. This is a separate authorized data operation, not an embedded identity in a schema migration. Do not grant access to other drivers by implication. A disabled participant can finish an existing own turn but cannot start another. All pilot turns are server-marked `is_test=true` and visibly labelled.

Publish this source branch only after approval. Open the existing `/teste/` portal using the participant's driver account. In the pilot, paste the existing vehicle QR link into the native turn field: printed permanent QRs still open the main portal and are not changed. Test one entry, refresh/reopen to confirm server persistence, then exit. Check the administrative history and the periodic review results. Do not create false trips, change assignments, alter original Google records or estimate missing mileage.

Checks are prepared every 15 minutes, with a bounded queue and retries. Uber/Bolt data coverage remains explicitly unconfirmed unless established by imports. Only Cartrack odometer readings are used for distances; their actual times and deviations are retained. Administrative release requires a reason and does not establish a real exit or authorize automatic mileage calculation.

## Isolated validation

The dedicated GitHub workflow runs synthetic Node tests, native-shift RLS/database tests using PGlite and the existing synchronization lifecycle tests, with read-only job permissions and no production secrets. Browser/mobile visual validation and the authenticated live pilot remain outstanding; previous browser attempts were blocked by the runtime and URL policy. No bypass was attempted.

For rollback, restore the previous `/teste/` frontend and disable the native review job/access grant. Preserve all pilot session records; do not drop tables or delete history. The full root application rollout remains in PR #85 and is separate from this test-only release.
