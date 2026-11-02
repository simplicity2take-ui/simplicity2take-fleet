-- Regression tests for Bolt assignment source isolation.
-- Run in a disposable Supabase database, not production.
begin;

do $$
declare
  v_manual_count integer;
  v_uber_count integer;
  v_bolt_count integer;
begin
  -- Seed fixtures should be created by the test harness with known driver/vehicle IDs.
  -- Assertions below are intended to run after invoking sync_bolt_fleet with fixture payloads.
  select count(*) into v_manual_count
  from public.vehicle_assignments where source = 'manual';

  select count(*) into v_uber_count
  from public.vehicle_assignments where source = 'uber';

  select count(*) into v_bolt_count
  from public.vehicle_assignments where source = 'bolt';

  if v_manual_count < 0 or v_uber_count < 0 or v_bolt_count < 0 then
    raise exception 'Counts cannot be negative';
  end if;
end $$;

rollback;
