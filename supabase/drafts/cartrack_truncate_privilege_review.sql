-- REVIEW-ONLY DRAFT. Do not execute in production.
-- Catalog inspection confirmed explicit TRUNCATE grants from postgres to
-- anon, authenticated and service_role on all three telemetry tables.
-- RLS does not protect TRUNCATE. The current Edge Function writer uses a
-- SECURITY DEFINER RPC owned by postgres, so service_role does not need direct
-- TRUNCATE privilege for that RPC to keep working.

revoke truncate on table
  public.cartrack_vehicles,
  public.cartrack_vehicle_snapshots,
  public.vehicle_odometer_readings
from public, anon, authenticated, service_role;

-- Verify after applying in a disposable database:
do $verify$
begin
  if has_table_privilege('anon', 'public.cartrack_vehicles', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.cartrack_vehicles', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.cartrack_vehicles', 'TRUNCATE')
     or has_table_privilege('anon', 'public.cartrack_vehicle_snapshots', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.cartrack_vehicle_snapshots', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.cartrack_vehicle_snapshots', 'TRUNCATE')
     or has_table_privilege('anon', 'public.vehicle_odometer_readings', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.vehicle_odometer_readings', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.vehicle_odometer_readings', 'TRUNCATE') then
    raise exception 'CarTrack telemetry tables still grant TRUNCATE to an API role';
  end if;
end;
$verify$;
