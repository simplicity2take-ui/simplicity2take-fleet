-- Regression guard for Bolt assignment source isolation.
-- Read-only against the function catalog; safe to run in a test or staging database.
-- This intentionally fails against the currently deployed implementation until fixed.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.sync_bolt_fleet(jsonb,jsonb,jsonb,timestamp with time zone)'::regprocedure
  )
  into v_definition;

  if v_definition is null then
    raise exception 'sync_bolt_fleet function was not found';
  end if;

  -- Bolt sync must never delete every assignment belonging to a driver.
  if v_definition ~* 'delete\s+from\s+public\.vehicle_assignments\s+where\s+driver_id\s*=\s*d_id\s*;' then
    raise exception 'Regression: Bolt sync still deletes assignments across all sources';
  end if;

  -- Any replacement/deletion must be explicitly scoped to Bolt-owned rows.
  if v_definition !~* 'source\s*=\s*''bolt''' then
    raise exception 'Regression: Bolt assignment mutation is not scoped to source=bolt';
  end if;

  -- New Bolt rows must be explicitly tagged, not rely on the table default ('manual').
  if v_definition !~* 'insert\s+into\s+public\.vehicle_assignments\s*\([^)]*source' then
    raise exception 'Regression: Bolt assignment insert does not explicitly set source';
  end if;
end $$;
