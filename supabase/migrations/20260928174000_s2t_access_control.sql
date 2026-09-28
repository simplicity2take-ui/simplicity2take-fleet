-- Simplicity2Take Fleet — access-control foundation
-- IMPORTANT: review against the live Supabase schema before running in production.
-- This migration is intentionally stored in GitHub first; it does not execute automatically.

create or replace function public.s2t_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and coalesce(p.status, 'Ativo') = 'Ativo'
  );
$$;

create or replace function public.s2t_driver_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select d.id
  from public.drivers d
  where d.profile_id = auth.uid()
  limit 1;
$$;

alter table public.profiles enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_assignments enable row level security;
alter table public.documents enable row level security;
alter table public.document_viewers enable row level security;

drop policy if exists "s2t_profiles_self_or_admin" on public.profiles;
create policy "s2t_profiles_self_or_admin"
on public.profiles for select
using (id = auth.uid() or public.s2t_is_admin());

drop policy if exists "s2t_drivers_admin_or_self" on public.drivers;
create policy "s2t_drivers_admin_or_self"
on public.drivers for select
using (public.s2t_is_admin() or profile_id = auth.uid());

drop policy if exists "s2t_vehicles_admin_or_assigned" on public.vehicles;
create policy "s2t_vehicles_admin_or_assigned"
on public.vehicles for select
using (
  public.s2t_is_admin()
  or exists (
    select 1 from public.vehicle_assignments va
    where va.vehicle_id = vehicles.id
      and va.driver_id = public.s2t_driver_id()
      and coalesce(va.active, true) = true
  )
);

drop policy if exists "s2t_vehicle_assignments_admin_or_self" on public.vehicle_assignments;
create policy "s2t_vehicle_assignments_admin_or_self"
on public.vehicle_assignments for select
using (public.s2t_is_admin() or driver_id = public.s2t_driver_id());

drop policy if exists "s2t_documents_admin_or_authorized_driver" on public.documents;
create policy "s2t_documents_admin_or_authorized_driver"
on public.documents for select
using (
  public.s2t_is_admin()
  or (
    driver_id = public.s2t_driver_id()
    and driver_id is not null
  )
  or (
    vehicle_id is not null
    and exists (
      select 1 from public.vehicle_assignments va
      where va.vehicle_id = documents.vehicle_id
        and va.driver_id = public.s2t_driver_id()
        and coalesce(va.active, true) = true
    )
  )
  or (
    documents.driver_id is null
    and exists (
      select 1 from public.document_viewers dv
      where dv.document_id = documents.id
        and dv.driver_id = public.s2t_driver_id()
    )
  )
);

drop policy if exists "s2t_document_viewers_admin_or_self" on public.document_viewers;
create policy "s2t_document_viewers_admin_or_self"
on public.document_viewers for select
using (public.s2t_is_admin() or driver_id = public.s2t_driver_id());

-- Writes remain administrator-only. Driver clients receive no insert/update/delete rights.
drop policy if exists "s2t_drivers_admin_write" on public.drivers;
create policy "s2t_drivers_admin_write"
on public.drivers for all
using (public.s2t_is_admin())
with check (public.s2t_is_admin());

drop policy if exists "s2t_vehicles_admin_write" on public.vehicles;
create policy "s2t_vehicles_admin_write"
on public.vehicles for all
using (public.s2t_is_admin())
with check (public.s2t_is_admin());

drop policy if exists "s2t_vehicle_assignments_admin_write" on public.vehicle_assignments;
create policy "s2t_vehicle_assignments_admin_write"
on public.vehicle_assignments for all
using (public.s2t_is_admin())
with check (public.s2t_is_admin());

drop policy if exists "s2t_documents_admin_write" on public.documents;
create policy "s2t_documents_admin_write"
on public.documents for all
using (public.s2t_is_admin())
with check (public.s2t_is_admin());

drop policy if exists "s2t_document_viewers_admin_write" on public.document_viewers;
create policy "s2t_document_viewers_admin_write"
on public.document_viewers for all
using (public.s2t_is_admin())
with check (public.s2t_is_admin());

-- The frontend must never expose Google Drive public links to drivers.
-- Production document opening should go through a server-side function that
-- verifies the current user's authorization before returning a short-lived URL.
