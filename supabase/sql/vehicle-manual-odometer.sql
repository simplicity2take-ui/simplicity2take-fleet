-- Proposed installation for the internal portal. No backfill or external integration.
begin;
create table public.fleet_manual_odometer (
  vehicle_id uuid not null,
  recorded_by uuid not null default auth.uid(),
  request_id uuid not null,
  km numeric not null check (km >= 0 and km < 'Infinity'::numeric and km = trunc(km) and km <= 9007199254740991),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (recorded_by, request_id)
);
create index fleet_manual_odometer_vehicle_date on public.fleet_manual_odometer
  (vehicle_id, recorded_at desc, recorded_by, request_id);

alter table public.fleet_manual_odometer enable row level security;
revoke all on public.fleet_manual_odometer from public, anon, authenticated;
grant select on public.fleet_manual_odometer to authenticated;
grant insert (vehicle_id, request_id, km) on public.fleet_manual_odometer to authenticated;

-- Visibility follows the underlying vehicle policy. Retain historical identifiers
-- even when a vehicle or account is subsequently removed.
create policy manual_odometer_read on public.fleet_manual_odometer for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.status = 'Ativo')
  and exists (select 1 from public.vehicles v where v.id = fleet_manual_odometer.vehicle_id)
);
create policy manual_odometer_insert on public.fleet_manual_odometer for insert to authenticated
with check (
  recorded_by = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.status = 'Ativo')
  and exists (select 1 from public.vehicles v where v.id = fleet_manual_odometer.vehicle_id)
);

create function public.fleet_record_manual_odometer(p_vehicle_id uuid, p_request_id uuid, p_km numeric)
returns timestamptz language plpgsql security invoker set search_path = '' as $$
declare
  saved public.fleet_manual_odometer%rowtype;
begin
  insert into public.fleet_manual_odometer(vehicle_id, request_id, km)
    values (p_vehicle_id, p_request_id, p_km)
    on conflict (recorded_by, request_id) do nothing;

  select * into strict saved from public.fleet_manual_odometer
    where recorded_by = auth.uid() and request_id = p_request_id;
  if saved.vehicle_id is distinct from p_vehicle_id or saved.km is distinct from p_km then
    raise exception 'Pedido de leitura já utilizado com outros dados';
  end if;
  return saved.recorded_at;
end;
$$;
revoke all on function public.fleet_record_manual_odometer(uuid,uuid,numeric) from public, anon;
grant execute on function public.fleet_record_manual_odometer(uuid,uuid,numeric) to authenticated;
commit;
