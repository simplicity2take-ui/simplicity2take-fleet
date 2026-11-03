#!/usr/bin/env bash
set -euo pipefail
if [ -z "$DATABASE_URL" ]; then echo "DATABASE_URL is required" >&2; exit 2; fi
lock_log="$(mktemp)"; first_log="$(mktemp)"; second_log="$(mktemp)"
trap 'rm -f "$lock_log" "$first_log" "$second_log"' EXIT
psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 >"$lock_log" 2>&1 <<'SQL' &
BEGIN;
SELECT id FROM public.drivers WHERE id='a1000000-0000-0000-0000-000000000004'::uuid FOR UPDATE;
SELECT pg_sleep(2);
COMMIT;
SQL
lock_pid=$!
sleep 0.25
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SELECT public.reconcile_bolt_vehicle_assignment('a1000000-0000-0000-0000-000000000004'::uuid,'b2000000-0000-0000-0000-000000000005'::uuid,current_date+2)" >"$first_log" 2>&1 &
first_pid=$!
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SELECT public.reconcile_bolt_vehicle_assignment('a1000000-0000-0000-0000-000000000004'::uuid,'b2000000-0000-0000-0000-000000000006'::uuid,current_date+2)" >"$second_log" 2>&1 &
second_pid=$!
wait "$first_pid"; wait "$second_pid"; wait "$lock_pid"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.vehicle_assignments
   WHERE driver_id='a1000000-0000-0000-0000-000000000004'::uuid
     AND source='bolt' AND active_until IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'concurrent reconciliation left % open Bolt rows', n; END IF;
END
$$;
SQL
