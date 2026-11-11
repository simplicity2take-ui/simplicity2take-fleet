-- Install only after driver_shift_sessions and the authenticated shift-review function.
-- Uses the existing scoped key; never returns it or changes the Cartrack sync schedule.
SELECT cron.schedule('s2t-native-shift-review','*/15 * * * *',$job$
 SELECT net.http_post(
   url:='https://lmutpimlokagjwngqanx.supabase.co/functions/v1/shift-review',
   headers:=jsonb_build_object('Content-Type','application/json','x-cartrack-sync-key',
     (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cartrack_sync_job_key')),
   body:='{}'::jsonb,timeout_milliseconds:=180000
 );
$job$);
