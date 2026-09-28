-- Simplicity2Take Fleet — permanent QR identity for vehicles
-- Review/run against the live Supabase database after confirming the vehicles schema.

alter table public.vehicles
  add column if not exists qr_token text;

update public.vehicles
set qr_token = lower(replace(gen_random_uuid()::text, '-', ''))
where qr_token is null or btrim(qr_token) = '';

create unique index if not exists vehicles_qr_token_unique
  on public.vehicles(qr_token);

alter table public.vehicles
  alter column qr_token set default lower(replace(gen_random_uuid()::text, '-', ''));

-- QR identity is generated once and is not changed when the assigned driver changes.
-- The application should never overwrite qr_token during normal vehicle edits.
