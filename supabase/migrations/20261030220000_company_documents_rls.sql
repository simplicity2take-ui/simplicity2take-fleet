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
    case when dr.company_id = vh.company_id then dr.company_id else null end
  when d.driver_id is not null then dr.company_id
  when d.vehicle_id is not null then vh.company_id
  else (select c.id from public.companies c where c.slug = 'simplicity2take')
end
from (select 1) as seed
left join public.drivers dr on dr.id = d.driver_id
left join public.vehicles vh on vh.id = d.vehicle_id
where d.company_id is null;

create index if not exists documents_company_id_idx
  on public.documents(company_id);

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
        and coalesce(va.active, true) = true
    )
  )
  or (
    driver_id is null
    and exists (
      select 1
      from public.document_viewers dv
      where dv.document_id = documents.id
        and dv.driver_id = public.s2t_driver_id()
    )
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

comment on column public.documents.company_id is
  'Owning company for document access. NULL indicates unresolved/inconsistent ownership and is hidden from company members.';
comment on policy "s2t documents company scope" on public.documents is
  'Global admins and company admins can read their permitted scope; drivers retain own, assigned-vehicle and explicit-viewer access. Ambiguous company ownership fails closed.';
comment on policy "s2t document viewers company scope" on public.document_viewers is
  'Company admins can inspect viewer grants only for documents owned by their company; drivers can inspect their own grants.';
