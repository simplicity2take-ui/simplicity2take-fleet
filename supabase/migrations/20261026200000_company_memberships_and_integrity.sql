-- Simplicity2Take Fleet — company membership and assignment integrity.
-- Draft follow-up migration; depends on 20261026190000_company_fleet_foundation.sql.
-- Review and test in an isolated database before applying anywhere.
-- This still does NOT complete tenant RLS for every table.

create table if not exists public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member'
    check (role in ('company_admin', 'member')),
  status text not null default 'Ativo'
    check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, profile_id)
);

create index if not exists company_memberships_profile_status_idx
  on public.company_memberships(profile_id, status);

create index if not exists company_memberships_company_status_idx
  on public.company_memberships(company_id, status);

-- Harden the pre-existing global-admin helper before using it from the new
-- company-scoped SECURITY DEFINER functions and RLS policies. Keep its return
-- value limited to the caller's own profile and pin all name resolution.
create or replace function public.s2t_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and coalesce(p.status, 'Ativo') = 'Ativo'
  );
$;

revoke all on function public.s2t_is_admin() from public, anon;
grant execute on function public.s2t_is_admin() to authenticated;

-- These helpers deliberately use SECURITY DEFINER to evaluate membership without
-- depending on caller visibility of other membership rows. Pin the search path and
-- schema-qualify every relation/function to prevent object-shadowing attacks.
create or replace function public.s2t_is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.s2t_is_admin()
    or exists (
      select 1
      from public.company_memberships cm
      where cm.company_id = p_company_id
        and cm.profile_id = auth.uid()
        and cm.status = 'Ativo'
    );
$$;

create or replace function public.s2t_is_company_admin(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.s2t_is_admin()
    or exists (
      select 1
      from public.company_memberships cm
      where cm.company_id = p_company_id
        and cm.profile_id = auth.uid()
        and cm.status = 'Ativo'
        and cm.role = 'company_admin'
    );
$$;

-- Expose only the boolean membership checks to authenticated sessions.
revoke all on function public.s2t_is_company_member(uuid) from public, anon;
revoke all on function public.s2t_is_company_admin(uuid) from public, anon;
grant execute on function public.s2t_is_company_member(uuid) to authenticated;
grant execute on function public.s2t_is_company_admin(uuid) to authenticated;

-- Company staff need to read the company record that their active membership grants access to.
-- Keep company mutations restricted to global administrators until a server-side workflow exists.
drop policy if exists "s2t company members read own company" on public.companies;
create policy "s2t company members read own company"
on public.companies for select
to authenticated
using (public.s2t_is_company_member(id));

alter table public.company_memberships enable row level security;

drop policy if exists "s2t memberships self or global admin" on public.company_memberships;
create policy "s2t memberships self or global admin"
on public.company_memberships for select
to authenticated
using (profile_id = (select auth.uid()) or public.s2t_is_admin());

drop policy if exists "s2t memberships global admin writes" on public.company_memberships;
create policy "s2t memberships global admin writes"
on public.company_memberships for all
to authenticated
using (public.s2t_is_admin())
with check (public.s2t_is_admin());

revoke all on public.company_memberships from anon, authenticated;
grant select, insert, update, delete on public.company_memberships to authenticated;

-- Trigger-only integrity guard. SECURITY DEFINER is needed to inspect both parent
-- records independently of caller RLS; it is not an RPC and must not be callable
-- directly by API roles.
create or replace function public.s2t_guard_assignment_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  driver_company uuid;
  vehicle_company uuid;
begin
  if new.driver_id is null or new.vehicle_id is null then
    raise exception 'Atribuição recusada: motorista e viatura são obrigatórios'
      using errcode = '23502';
  end if;

  select d.company_id into driver_company
  from public.drivers d where d.id = new.driver_id;

  select v.company_id into vehicle_company
  from public.vehicles v where v.id = new.vehicle_id;

  if driver_company is null or vehicle_company is null then
    raise exception 'Atribuição recusada: empresa do motorista ou da viatura não definida'
      using errcode = '23514';
  end if;

  if driver_company <> vehicle_company then
    raise exception 'Atribuição recusada: motorista e viatura pertencem a empresas diferentes'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.s2t_guard_assignment_company() from public, anon, authenticated;

drop trigger if exists s2t_assignment_company_guard on public.vehicle_assignments;
create trigger s2t_assignment_company_guard
before insert or update of driver_id, vehicle_id
on public.vehicle_assignments
for each row execute function public.s2t_guard_assignment_company();

comment on table public.company_memberships is
  'Company membership and role assignments. Draft: company-admin writes must be delegated through a validated server-side workflow before external use.';
comment on function public.s2t_guard_assignment_company() is
  'Trigger-only guard: rejects missing IDs and assignments whose driver and vehicle have different company IDs. Requires company ownership migration first.';
