-- Simplicity2Take Fleet — tenant-aware read access for platform history.
-- Depends on the company foundation and membership/integrity migrations.
-- This migration scopes only platform activity/trips; it does not complete
-- tenant isolation for Uber report tables, CarTrack, documents or other datasets.
-- Test in an isolated PostgreSQL/Supabase environment before any deployment.

drop policy if exists "s2t_platform_activity_admin_or_assigned"
  on public.platform_activity_events;
create policy "s2t_platform_activity_company_scope"
on public.platform_activity_events
for select
to authenticated
using (
  public.s2t_is_admin()
  or driver_id = public.s2t_driver_id()
  or exists (
    select 1
    from public.drivers d
    where d.id = platform_activity_events.driver_id
      and public.s2t_is_company_member(d.company_id)
      and (
        platform_activity_events.vehicle_id is null
        or exists (
          select 1
          from public.vehicles v
          where v.id = platform_activity_events.vehicle_id
            and v.company_id = d.company_id
        )
      )
  )
  or (
    platform_activity_events.driver_id is null
    and exists (
      select 1
      from public.vehicles v
      where v.id = platform_activity_events.vehicle_id
        and public.s2t_is_company_member(v.company_id)
    )
  )
);

drop policy if exists "s2t_platform_trips_admin_or_assigned"
  on public.platform_trip_records;
create policy "s2t_platform_trips_company_scope"
on public.platform_trip_records
for select
to authenticated
using (
  public.s2t_is_admin()
  or driver_id = public.s2t_driver_id()
  or exists (
    select 1
    from public.drivers d
    where d.id = platform_trip_records.driver_id
      and public.s2t_is_company_member(d.company_id)
      and (
        platform_trip_records.vehicle_id is null
        or exists (
          select 1
          from public.vehicles v
          where v.id = platform_trip_records.vehicle_id
            and v.company_id = d.company_id
        )
      )
  )
  or (
    platform_trip_records.driver_id is null
    and exists (
      select 1
      from public.vehicles v
      where v.id = platform_trip_records.vehicle_id
        and public.s2t_is_company_member(v.company_id)
    )
  )
);

comment on policy "s2t_platform_activity_company_scope"
  on public.platform_activity_events is
  'Allows global admins, the linked driver, or active members of the single owning company. Rows with conflicting driver/vehicle ownership are not exposed to company members.';
comment on policy "s2t_platform_trips_company_scope"
  on public.platform_trip_records is
  'Allows global admins, the linked driver, or active members of the single owning company. Rows with conflicting driver/vehicle ownership are not exposed to company members.';
