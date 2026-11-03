-- Read-only diagnostics for company-scoped document migration.
-- Run only in a disposable test database after the company and document migrations.

-- 1) Documents with unresolved company ownership must not be exposed to company members.
select
  count(*) filter (where company_id is null) as documents_without_company,
  count(*) as total_documents
from public.documents;

-- 2) Identify documents whose linked driver and vehicle disagree on ownership.
select d.id, d.driver_id, d.vehicle_id, dr.company_id as driver_company_id,
       vh.company_id as vehicle_company_id, d.company_id as document_company_id
from public.documents d
join public.drivers dr on dr.id = d.driver_id
join public.vehicles vh on vh.id = d.vehicle_id
where dr.company_id <> vh.company_id;

-- 3) Check document and viewer RLS flags.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('documents', 'document_viewers')
order by c.relname;

-- 4) Review effective policies; compare against the approved access matrix.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('documents', 'document_viewers')
order by tablename, policyname;
