alter table public.drivers
  add column if not exists bolt_driver_uuid text,
  add column if not exists bolt_partner_uuid text,
  add column if not exists bolt_last_synced_at timestamptz;

alter table public.vehicles
  add column if not exists bolt_vehicle_uuid text,
  add column if not exists bolt_last_synced_at timestamptz;

create unique index if not exists drivers_bolt_driver_uuid_uidx
  on public.drivers (bolt_driver_uuid)
  where bolt_driver_uuid is not null;

create unique index if not exists vehicles_bolt_vehicle_uuid_uidx
  on public.vehicles (bolt_vehicle_uuid)
  where bolt_vehicle_uuid is not null;
