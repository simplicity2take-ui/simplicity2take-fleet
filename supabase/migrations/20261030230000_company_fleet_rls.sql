-- Simplicity2Take Fleet — company-scoped drivers, vehicles and assignments.
-- Draft only: review and test against a disposable Supabase database before applying.
-- Depends on:
--   20261026190000_company_fleet_foundation.sql
--   20261026200000_company_memberships_and_integrity.sql
--
-- Company members can read their own company's fleet. Only company_admin (or a
-- global admin) can create/update fleet records and manage assignments.
-- Drivers retain self/assigned-vehicle access. Ownership changes remain global-admin-only.

create or replace function public.s2t_assignment_company_id(p_assignment_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select d.company_id
  from public.vehicle_assignments va
  join public.drivers d on d.id = va.driver_id
  join public.vehicles v on v.id = va.vehicle_id and v.company_id = d.company_id
  where va.id = p_assignment_id
  limit 1;
$function$;

create or replace function public.s2t_can_manage_assignment(
  p_driver_id uuid,
  p_vehicle_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.drivers d
    join public.vehicles v on v.company_id = d.company_id
    where d.id = p_driver_id
      and v.id = p_vehicle_id
      and public.s2t_is_company_admin(d.company_id)
  );
$function$;

revoke all on function public.s2t_assignment_company_id(uuid) from public, anon;
revoke all on function public.s2t_can_manage_assignment(uuid, uuid) from public, anon;
grant execute on function public.s2t_assignment_company_id(uuid) to authenticated;
grant execute on function public.s2t_can_manage_assignment(uuid, uuid) to authenticated;

-- Prevent company administrators from moving a record into another tenant.
-- Global administrators retain the ability to correct ownership.
create or replace function public.s2t_guard_company_ownership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.company_id is distinct from old.company_id
     and not public.s2t_is_admin() then
    raise exception 'Alteração da empresa proprietária reservada ao administrador global'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.s2t_guard_company_ownership_change() from public, anon, authenticated;

drop trigger if exists s2t_drivers_company_ownership_guard on public.drivers;
create trigger s2t_drivers_company_ownership_guard
before update of company_id on public.drivers
for each row execute function public.s2t_guard_company_ownership_change();

drop trigger if exists s2t_vehicles_company_ownership_guard on public.vehicles;
create trigger s2t_vehicles_company_ownership_guard
before update of company_id on public.vehicles
for each row execute function public.s2t_guard_company_ownership_change();

-- Drivers: company staff can read their company's drivers; drivers can still read themselves.
drop policy if exists "s2t_drivers_admin_or_self" on public.drivers;
drop policy if exists "s2t_drivers_admin_write" on public.drivers;
drop policy if exists "s2t drivers company read" on public.drivers;
drop policy if exists "s2t drivers company admin insert" on public.drivers;
drop policy if exists "s2t drivers company admin update" on public.drivers;

create policy "s2t drivers company read"
on public.drivers for select to authenticated
using (
  public.s2t_is_admin()
  or public.s2t_is_company_member(company_id)
  or profile_id = (select auth.uid())
);

create policy "s2t drivers company admin insert"
on public.drivers for insert to authenticated
with check (
  public.s2t_is_admin()
  or public.s2t_is_company_admin(company_id)
);

create policy "s2t drivers company admin update"
on public.drivers for update to authenticated
using (
  public.s2t_is_admin()
  or public.s2t_is_company_admin(company_id)
)
with check (
  public.s2t_is_admin()
  or public.s2t_is_company_admin(company_id)
);

-- Deletion remains global-admin-only; driver and company records are operational history.

-- Vehicles: company staff can read their company's vehicles; drivers retain access
-- to vehicles currently assigned to them.
drop policy if exists "s2t_vehicles_admin_or_assigned" on public.vehicles;
drop policy if exists "s2t_vehicles_admin_write" on public.vehicles;
drop policy if exists "s2t vehicles company read" on public.vehicles;
drop policy if exists "s2t vehicles company admin insert" on public.vehicles;
drop policy if exists "s2t vehicles company admin update" on public.vehicles;

create policy "s2t vehicles company read"
on public.vehicles for select to authenticated
using (
  public.s2t_is_admin()
  or public.s2t_is_company_member(company_id)
  or exists (
    select 1 from public.vehicle_assignments va
    where va.vehicle_id = vehicles.id
      and va.driver_id = public.s2t_driver_id()
      and coalesce(va.active, true) = true
  )
);

create policy "s2t vehicles company admin insert"
on public.vehicles for insert to authenticated
with check (
  public.s2t_is_admin()
  or public.s2t_is_company_admin(company_id)
);

create policy "s2t vehicles company admin update"
on public.vehicles for update to authenticated
using (
  public.s2t_is_admin()
  or public.s2t_is_company_admin(company_id)
)
with check (
  public.s2t_is_admin()
  or public.s2t_is_company_admin(company_id)
);

-- Assignment reads use a SECURITY DEFINER helper to avoid recursive RLS
-- (vehicles policy also consults vehicle_assignments).
drop policy if exists "s2t_vehicle_assignments_admin_or_self" on public.vehicle_assignments;
drop policy if exists "s2t_vehicle_assignments_admin_write" on public.vehicle_assignments;
drop policy if exists "s2t assignments company read" on public.vehicle_assignments;
drop policy if exists "s2t assignments company admin insert" on public.vehicle_assignments;
drop policy if exists "s2t assignments company admin update" on public.vehicle_assignments;
drop policy if exists "s2t assignments company admin delete" on public.vehicle_assignments;

create policy "s2t assignments company read"
on public.vehicle_assignments for select to authenticated
using (
  public.s2t_is_admin()
  or public.s2t_is_company_member(public.s2t_assignment_company_id(id))
  or driver_id = public.s2t_driver_id()
);

create policy "s2t assignments company admin insert"
on public.vehicle_assignments for insert to authenticated
with check (
  public.s2t_is_admin()
  or public.s2t_can_manage_assignment(driver_id, vehicle_id)
);

create policy "s2t assignments company admin update"
on public.vehicle_assignments for update to authenticated
using (
  public.s2t_is_admin()
  or public.s2t_can_manage_assignment(driver_id, vehicle_id)
)
with check (
  public.s2t_is_admin()
  or public.s2t_can_manage_assignment(driver_id, vehicle_id)
);

create policy "s2t assignments company admin delete"
on public.vehicle_assignments for delete to authenticated
using (
  public.s2t_is_admin()
  or public.s2t_can_manage_assignment(driver_id, vehicle_id)
);

comment on function public.s2t_assignment_company_id(uuid) is
  'Returns the shared company ID for a valid driver/vehicle assignment; SECURITY DEFINER avoids recursive RLS.';
comment on function public.s2t_can_manage_assignment(uuid, uuid) is
  'Checks that caller is global admin or company_admin for the common company of the driver and vehicle.';
comment on function public.s2t_guard_company_ownership_change() is
  'Trigger-only guard: only global admins may change company ownership on drivers or vehicles.';
