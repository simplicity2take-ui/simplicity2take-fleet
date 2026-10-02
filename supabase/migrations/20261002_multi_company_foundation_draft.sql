-- Multi-company foundation (DRAFT — do not apply to production until reviewed).
-- Adds tenant ownership without changing existing access policies yet.
-- The follow-up migration must replace all tenant-sensitive RLS policies before
-- any external company account is enabled.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner','admin','driver')),
  created_at timestamptz not null default now(),
  primary key (organization_id, profile_id)
);

-- Tenant keys are initially nullable to permit a controlled backfill.
alter table public.profiles add column if not exists organization_id uuid references public.organizations(id);
alter table public.drivers add column if not exists organization_id uuid references public.organizations(id);
alter table public.vehicles add column if not exists organization_id uuid references public.organizations(id);
alter table public.applications add column if not exists organization_id uuid references public.organizations(id);
alter table public.documents add column if not exists organization_id uuid references public.organizations(id);
alter table public.audit_log add column if not exists organization_id uuid references public.organizations(id);

-- Existing records are assigned to the original company. The first admin
-- profile is linked as an owner; driver profiles inherit their driver's tenant.
insert into public.organizations (name, display_name, slug)
values ('Simplicity2Take', 'Simplicity2Take', 'simplicity2take')
on conflict (slug) do nothing;

update public.profiles p
set organization_id = o.id
from public.organizations o
where o.slug = 'simplicity2take' and p.organization_id is null
  and p.role = 'admin';

update public.drivers d
set organization_id = o.id
from public.organizations o
where o.slug = 'simplicity2take' and d.organization_id is null;

update public.profiles p
set organization_id = d.organization_id
from public.drivers d
where d.profile_id = p.id and p.organization_id is null;

update public.vehicles v
set organization_id = o.id
from public.organizations o
where o.slug = 'simplicity2take' and v.organization_id is null;

update public.documents doc
set organization_id = coalesce(d.organization_id, v.organization_id, o.id)
from public.organizations o
left join public.drivers d on d.id = doc.driver_id
left join public.vehicles v on v.id = doc.vehicle_id
where o.slug = 'simplicity2take' and doc.organization_id is null;

update public.applications a
set organization_id = o.id
from public.organizations o
where o.slug = 'simplicity2take' and a.organization_id is null;

update public.audit_log l
set organization_id = p.organization_id
from public.profiles p
where p.id = l.user_id and l.organization_id is null;

insert into public.organization_memberships (organization_id, profile_id, role)
select p.organization_id, p.id,
       case when p.role = 'admin' then 'owner' else 'driver' end
from public.profiles p
where p.organization_id is not null
on conflict (organization_id, profile_id) do nothing;

-- Intentionally no RLS policy changes in this foundation migration.
-- Before inviting another company, add tenant-aware policies and update every
-- privileged Edge Function (including Bolt sync) to validate tenant scope.
