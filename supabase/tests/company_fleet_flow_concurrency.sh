#!/usr/bin/env bash
set -euo pipefail

: "\${DATABASE_URL:?DATABASE_URL is required}"
work_dir="$(mktemp -d)"
archive_log="$work_dir/archive.log"
assignment_log="$work_dir/assignment.log"
deactivate_log="$work_dir/deactivate.log"
reassign_log="$work_dir/reassign.log"
trap 'rm -rf "$work_dir"' EXIT

wait_for_lock_waiter() {
  for attempt in $(seq 1 50); do
    waiting="$(psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_stat_activity WHERE datname='fleet_test' AND pid <> pg_backend_pid() AND wait_event_type='Lock'")"
    if [[ "$waiting" -gt 0 ]]; then return 0; fi
    sleep 0.1
  done
  echo "No concurrent transaction reached a lock wait"
  return 1
}

archive_vehicle_id="30000000-0000-0000-0000-000000000005"
archive_driver_id="20000000-0000-0000-0000-000000000005"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$archive_log" 2>&1 <<SQL &
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
BEGIN;
SELECT id FROM public.vehicles WHERE id='$archive_vehicle_id' FOR UPDATE;
SELECT pg_sleep(2);
SELECT public.s2t_archive_vehicle('$archive_vehicle_id');
COMMIT;
SQL
archive_pid=$!
sleep 0.2
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$assignment_log" 2>&1 <<SQL &
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT public.s2t_replace_vehicle_assignments('$archive_vehicle_id', ARRAY['$archive_driver_id']::uuid[]);
SQL
assignment_pid=$!
wait_for_lock_waiter
set +e
wait "$assignment_pid"
assignment_rc=$?
set -e
wait "$archive_pid"
if [[ "$assignment_rc" -eq 0 ]] || ! grep -Eiq "inativa ou arquivada" "$assignment_log"; then
  cat "$assignment_log"
  echo "Assignment race did not observe the archived vehicle"
  exit 1
fi
archive_state="$(psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT status FROM public.vehicles WHERE id='$archive_vehicle_id'")"
active_count="$(psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.vehicle_assignments WHERE vehicle_id='$archive_vehicle_id' AND active_from <= current_date AND (active_until IS NULL OR active_until >= current_date)")"
if [[ "$archive_state" != "Inativo" || "$active_count" != "0" ]]; then
  echo "Archive race left an active vehicle or assignment"
  exit 1
fi

deactivate_driver_id="20000000-0000-0000-0000-000000000006"
deactivate_vehicle_id="30000000-0000-0000-0000-000000000006"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "INSERT INTO public.vehicle_assignments (vehicle_id,driver_id,active_from) VALUES ('$deactivate_vehicle_id','$deactivate_driver_id',current_date-1) ON CONFLICT (vehicle_id,driver_id,active_from) DO NOTHING"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$deactivate_log" 2>&1 <<SQL &
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('s2t-driver:' || '$deactivate_driver_id',0));
SELECT pg_sleep(2);
SELECT public.s2t_deactivate_driver('$deactivate_driver_id');
COMMIT;
SQL
deactivate_pid=$!
sleep 0.2
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$reassign_log" 2>&1 <<SQL &
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT public.s2t_replace_vehicle_assignments('$deactivate_vehicle_id', ARRAY['$deactivate_driver_id']::uuid[]);
SQL
reassign_pid=$!
wait_for_lock_waiter
set +e
wait "$reassign_pid"
reassign_rc=$?
set -e
wait "$deactivate_pid"
if [[ "$reassign_rc" -eq 0 ]] || ! grep -Eiq "motoristas ativos da mesma empresa" "$reassign_log"; then
  cat "$reassign_log"
  echo "Driver deactivation race allowed a new assignment"
  exit 1
fi
driver_status="$(psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT status FROM public.drivers WHERE id='$deactivate_driver_id'")"
driver_active_count="$(psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.vehicle_assignments WHERE driver_id='$deactivate_driver_id' AND active_from <= current_date AND (active_until IS NULL OR active_until >= current_date)")"
if [[ "$driver_status" != "Inativo" || "$driver_active_count" != "0" ]]; then
  echo "Driver deactivation race left an active assignment"
  exit 1
fi

echo "PASS: archive/assignment and driver deactivation/assignment races are serialized"
