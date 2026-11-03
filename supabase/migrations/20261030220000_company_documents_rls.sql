-- Simplicity2Take Fleet — company-scoped document access.
-- Draft only. Depends on:
--   20261026190000_company_fleet_foundation.sql
--   20261026200000_company_memberships_and_integrity.sql
-- Apply and test only in a disposable local Supabase/PostgreSQL environment.
--
-- Documents with inconsistent driver/vehicle ownership are deliberately left
-- without company_id and are not exposed to company members.

alter table public.documents
  add column if not exists company_id uuid
  references public.companies(id) on delete restrict;

-- Derive ownership only when the linked records agree. Company-level documents
-- (no driver or vehicle link) belong to the current S2T company for this rollout.
update public.documents d
set company_id = case
  when d.driver_id is not null and d.vehicle_id is not null then
    case
      when (select dr.company_id from public.drivers dr where dr.id = d.driver_id)
         = (select vh.company_id from public.vehicles vh where vh.id = d.vehicle_id)
      then (select dr.company_id from public.drivers dr where dr.id = d.driver_id)
      else null
    end
  when d.driver_id is not null then
    (select dr.company_id from public.drivers dr where dr.id = d.driver_id)
  when d.vehicle_id is not null then
    (select vh.company_id from public.vehicles vh where vh.id = d.vehicle_id)
  else
    (select c.id from public.companies c where c.slug = 'simplicity2take')
end
where d.company_id is null;

create index if not exists documents_company_id_idx
  on public.documents(company_id);

alter table public.documents enable row level security;
alter table public.document_viewers enable row level security;

-- Avoid a recursive RLS dependency: documents can consult this SECURITY DEFINER
-- helper, while document_viewers may safely consult documents in its own policy.
-- The helper checks only the authenticated driver's explicit viewer grant.
create or replace function public.s2t_driver_can_view_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.document_viewers dv
    where dv.document_id = p_document_id
      and dv.driver_id = public.s2t_driver_id()
      and dv.can_view = true
  );
$function$;

revoke all on function public.s2t_driver_can_view_document(uuid) from public, anon;
grant execute on function public.s2t_driver_can_view_document(uuid) to authenticated;

-- Remove the old permissive document read policy before replacing it with a
-- single policy that combines global admin, company-admin and driver access.
drop policy if exists "s2t_documents_admin_or_authorized_driver" on public.documents;
drop policy if exists "s2t documents company scope" on public.documents;

create policy "s2t documents company scope"
on public.documents for select
to authenticated
using (
  public.s2t_is_admin()
  or (
    company_id is not null
    and public.s2t_is_company_admin(company_id)
  )
  or (
    company_id is not null
    and driver_id is null
    and vehicle_id is null
    and public.s2t_is_company_member(company_id)
  )
  or (
    driver_id is not null
    and driver_id = public.s2t_driver_id()
  )
  or (
    vehicle_id is not null
    and exists (
      select 1
      from public.vehicle_assignments va
      where va.vehicle_id = documents.vehicle_id
        and va.driver_id = public.s2t_driver_id()
        and va.active_from <= current_date
        and (va.active_until is null or va.active_until >= current_date)
    )
  )
  or (
    driver_id is null
    and public.s2t_driver_can_view_document(documents.id)
  )
);

-- A company member may see viewer grants only for documents in a company where
-- they have an active membership. Drivers retain visibility of their own grants.
drop policy if exists "s2t document viewers company scope" on public.document_viewers;
create policy "s2t document viewers company scope"
on public.document_viewers for select
to authenticated
using (
  public.s2t_is_admin()
  or driver_id = public.s2t_driver_id()
  or exists (
    select 1
    from public.documents d
    where d.id = document_viewers.document_id
      and d.company_id is not null
      and public.s2t_is_company_admin(d.company_id)
  )
);

comment on function public.s2t_driver_can_view_document(uuid) is
  'Checks an explicit document-viewer grant for the authenticated driver without recursive RLS evaluation.';
comment on column public.documents.company_id is
  'Owning company for document access. NULL indicates unresolved/inconsistent ownership and is hidden from company members.';
comment on policy "s2t documents company scope" on public.documents is
  'Global admins and company admins can read their permitted scope; drivers retain own, assigned-vehicle and explicit-viewer access. Ambiguous company ownership fails closed.';
comment on policy "s2t document viewers company scope" on public.document_viewers is
  'Company admins can inspect viewer grants only for documents owned by their company; drivers can inspect their own grants.';
