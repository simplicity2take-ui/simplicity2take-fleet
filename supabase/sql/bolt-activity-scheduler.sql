-- Install only after the guarded function is verified with scoped job authentication.
-- Three runs per day in UTC; Europe/Lisbon is one hour ahead during summer time.
SELECT cron.schedule('s2t-bolt-activity-three-daily','0 2,10,18 * * *',$job$
 SELECT net.http_post(
  url:='https://lmutpimlokagjwngqanx.supabase.co/functions/v1/bolt-activity-sync',
  headers:=jsonb_build_object('Content-Type','application/json','x-cartrack-sync-key',
   (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cartrack_sync_job_key')),
  body:='{}'::jsonb,timeout_milliseconds:=180000);
$job$);
