-- Simplicity2Take Fleet — company ownership foundation.
-- Draft migration: review in a non-production environment before applying.
-- Existing fleet records are assigned to the current operating company.
-- This migration does not by itself enable multi-company RLS isolation.

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  legal_name text not null,
  display_name text not null,
  tax_number text,
  status text not null default 'Ativa'
    check (status in ('Ativa', 'Inativa')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.companies (slug, legal_name, display_name)
values ('simplicity2take', 'Simplicity2Take Unipessoal, Lda', 'Simplicity2Take')
on conflict (slug) do nothing;

alter table public.vehicles
  add column if not exists company_id uuid references public.companies(id) on delete restrict;

alter table public.drivers
  add column if not exists company_id uuid references public.companies(id) on delete restrict;

update public.vehicles
set company_id = (select id from public.companies where slug = 'simplicity2take')
where company_id is null;

update public.drivers
set company_id = (select id from public.companies where slug = 'simplicity2take')
where company_id is null;

create index if not exists vehicles_company_id_idx on public.vehicles(company_id);
create index if not exists drivers_company_id_idx on public.drivers(company_id);

alter table public.vehicles alter column company_id set not null;
alter table public.drivers alter column company_id set not null;

alter table public.companies enable row level security;

drop policy if exists "s2t companies admin read" on public.companies;
create policy "s2t companies admin read"
on public.companies for select
to authenticated
using (public.s2t_is_admin());

drop policy if exists "s2t companies admin write" on public.companies;
create policy "s2t companies admin write"
on public.companies for all
to authenticated
using (public.s2t_is_admin())
with check (public.s2t_is_admin());

revoke all on public.companies from anon, authenticated;
grant select, insert, update, delete on public.companies to authenticated;

comment on table public.companies is
  'Company directory and ownership anchor for Fleet. Apply only after review in an isolated environment.';
comment on column public.vehicles.company_id is
  'Owning company. Multi-company row-level access policies must be added before enabling external company users.';
comment on column public.drivers.company_id is
  'Employing/contracting company. Multi-company row-level access policies must be added before enabling external company users.';
