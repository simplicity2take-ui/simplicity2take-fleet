-- Read-only preflight: remaining multi-company operational datasets.
-- Run in an isolated/staging Supabase project before designing or applying RLS.
-- This file contains SELECT statements only; it does not change schema or data.

-- 1. Which operational tables exist, and is RLS enabled?
with expected(table_name) as (
  values
    ('platform_activity_events'),
    ('platform_trip_records'),
    ('cartrack_vehicles'),
    ('cartrack_vehicle_snapshots'),
    ('applications'),
    ('application_documents'),
    ('application_messages'),
    ('uber_driver_activity'),
    ('uber_driver_payments'),
    ('documents'),
    ('document_viewers')
)
select e.table_name,
       (c.oid is not null) as table_exists,
       coalesce(c.relrowsecurity, false) as rls_enabled,
       coalesce(c.relforcerowsecurity, false) as rls_forced
from expected e
left join pg_namespace n on n.nspname = 'public'
left join pg_class c on c.relnamespace = n.oid
                    and c.relname = e.table_name
                    and c.relkind in ('r','p')
order by e.table_name;

-- 2. Inspect all columns for the datasets above. Do not assume a company_id
-- column exists; tenant ownership may need to be derived through driver/vehicle.
select table_name, ordinal_position, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'platform_activity_events', 'platform_trip_records',
    'cartrack_vehicles', 'cartrack_vehicle_snapshots',
    'applications', 'application_documents', 'application_messages',
    'uber_driver_activity', 'uber_driver_payments',
    'documents', 'document_viewers'
  )
order by table_name, ordinal_position;

-- 3. Existing policies. Additional permissive policies are OR-combined in
-- PostgreSQL and can unintentionally bypass a new tenant policy.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'platform_activity_events', 'platform_trip_records',
    'cartrack_vehicles', 'cartrack_vehicle_snapshots',
    'applications', 'application_documents', 'application_messages',
    'uber_driver_activity', 'uber_driver_payments',
    'documents', 'document_viewers'
  )
order by tablename, policyname;

-- 4. Foreign keys reveal whether telemetry and applications can be safely
-- scoped through driver/vehicle/company relations.
select
  tc.table_name,
  kcu.column_name,
  ccu.table_name as referenced_table,
  ccu.column_name as referenced_column,
  tc.constraint_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.constraint_schema = kcu.constraint_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
 and ccu.constraint_schema = tc.constraint_schema
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = 'public'
  and tc.table_name in (
    'platform_activity_events', 'platform_trip_records',
    'cartrack_vehicles', 'cartrack_vehicle_snapshots',
    'applications', 'application_documents', 'application_messages',
    'uber_driver_activity', 'uber_driver_payments'
  )
order by tc.table_name, tc.constraint_name;

-- 5. Check for likely ownership and external identifiers without returning
-- any row-level personal data.
select table_name,
       bool_or(column_name = 'company_id') as has_company_id,
       bool_or(column_name = 'driver_id') as has_driver_id,
       bool_or(column_name = 'vehicle_id') as has_vehicle_id,
       bool_or(column_name in ('platform_driver_uuid','uber_driver_uuid','bolt_driver_uuid')) as has_platform_driver_key,
       bool_or(column_name in ('registration','vehicle_plate','platform_vehicle_uuid')) as has_vehicle_key
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'platform_activity_events', 'platform_trip_records',
    'cartrack_vehicles', 'cartrack_vehicle_snapshots',
    'applications', 'application_documents', 'application_messages',
    'uber_driver_activity', 'uber_driver_payments'
  )
group by table_name
order by table_name;

-- Review findings before writing policies:
-- * Platform activity/trip tables already have a draft company-aware read policy.
-- * CarTrack rows must be linked to a canonical vehicles.id before company access.
-- * Applications and candidate attachments/messages contain personal data and
--   must not be made visible to ordinary company members by default.
-- * Uber report tables may be imported snapshots with no stable driver FK; map
--   them through verified platform UUIDs and company-owned driver records first.
-- * Keep Google Drive file IDs and direct links server-side; use document-access.
