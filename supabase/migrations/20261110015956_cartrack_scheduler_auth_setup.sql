create extension if not exists pg_cron;
create extension if not exists pg_net;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
do $setup$
begin
  if not exists(select 1 from vault.secrets where name='cartrack_sync_job_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'cartrack_sync_job_key','Internal Cartrack scheduler credential');
  end if;
end $setup$;
create or replace function public.verify_cartrack_sync_key(candidate text)
returns boolean language sql stable security definer set search_path = '' as $verify$
  select candidate is not null and length(candidate)=64 and exists (
    select 1 from vault.decrypted_secrets s
    where s.name='cartrack_sync_job_key'
    and extensions.digest(s.decrypted_secret,'sha256')=extensions.digest(candidate,'sha256')
  );
$verify$;
revoke all on function public.verify_cartrack_sync_key(text) from public, anon, authenticated;
grant execute on function public.verify_cartrack_sync_key(text) to service_role;
create or replace function private.enqueue_cartrack_sync(force_run boolean default false)
returns bigint language plpgsql security invoker set search_path = '' as $enqueue$
declare job_key text; request_id bigint;
begin
  if not force_run and extract(hour from (now() at time zone 'Europe/Lisbon')) not in (7,12,17,21) then
    return null;
  end if;
  select decrypted_secret into strict job_key from vault.decrypted_secrets where name='cartrack_sync_job_key';
  select net.http_post(
    url := 'https://lmutpimlokagjwngqanx.supabase.co/functions/v1/cartrack-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-cartrack-sync-key',job_key),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end $enqueue$;
revoke all on function private.enqueue_cartrack_sync(boolean) from public, anon, authenticated, service_role;
