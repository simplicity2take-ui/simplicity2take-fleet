#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

wait_for_lock_waiters() {
  expected="$1"
  for attempt in $(seq 1 50); do
    waiting="$(psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_stat_activity WHERE datname='fleet_test' AND pid <> pg_backend_pid() AND wait_event_type='Lock'")"
    if [[ "$waiting" -ge "$expected" ]]; then return 0; fi
    sleep 0.1
  done
  echo "Expected $expected RPC sessions to wait on the assignment table lock"
  return 1
}

run_contended_pair() {
  label="$1"
  driver_a="$2"
  vehicle_a="$3"
  driver_b="$4"
  vehicle_b="$5"
  blocker_log="$work_dir/$label-blocker.log"
  log_a="$work_dir/$label-a.log"
  log_b="$work_dir/$label-b.log"

  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$blocker_log" 2>&1 <<'SQL' &
BEGIN;
LOCK TABLE public.vehicle_assignments IN ROW EXCLUSIVE MODE;
SELECT pg_sleep(2);
COMMIT;
SQL
  blocker_pid=$!
  sleep 0.2

  psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 >"$log_a" 2>&1 <<SQL &
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT public.s2t_bolt_assign_vehicle('$driver_a','$vehicle_a');
COMMIT;
SQL
  pid_a=$!

  psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 >"$log_b" 2>&1 <<SQL &
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT public.s2t_bolt_assign_vehicle('$driver_b','$vehicle_b');
COMMIT;
SQL
  pid_b=$!

  wait_for_lock_waiters 2
  wait "$blocker_pid"

  set +e
  wait "$pid_a"; rc_a=$?
  wait "$pid_b"; rc_b=$?
  set -e
  if [[ "$rc_a" -ne 0 || "$rc_b" -ne 0 ]]; then
    cat "$log_a" "$log_b"
    echo "A contended Bolt assignment RPC failed"
    return 1
  fi

  actions="$(grep -Eo '"action": "(created|conflict)"' "$log_a" "$log_b" | sort | tr '
' ' ')"
  created_count="$(grep -Eo '"action": "created"' "$log_a" "$log_b" | wc -l | tr -d ' ')"
  conflict_count="$(grep -Eo '"action": "conflict"' "$log_a" "$log_b" | wc -l | tr -d ' ')"
  if [[ "$created_count" != "1" || "$conflict_count" != "1" ]]; then
    cat "$log_a" "$log_b"
    echo "Expected one created and one conflicting decision; got: $actions"
    return 1
  fi
}

run_contended_pair "same-vehicle"   "20000000-0000-0000-0000-000000000001" "30000000-0000-0000-0000-000000000004"   "20000000-0000-0000-0000-000000000003" "30000000-0000-0000-0000-000000000004"
same_vehicle_active="$(psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.vehicle_assignments WHERE vehicle_id='30000000-0000-0000-0000-000000000004' AND active_from <= current_date AND (active_until IS NULL OR active_until >= current_date)")"
if [[ "$same_vehicle_active" != "1" ]]; then
  echo "Concurrent Bolt requests left $same_vehicle_active active assignments for one vehicle"
  exit 1
fi

run_contended_pair "same-driver"   "20000000-0000-0000-0000-000000000005" "30000000-0000-0000-0000-000000000001"   "20000000-0000-0000-0000-000000000005" "30000000-0000-0000-0000-000000000006"
same_driver_active="$(psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.vehicle_assignments WHERE driver_id='20000000-0000-0000-0000-000000000005' AND active_from <= current_date AND (active_until IS NULL OR active_until >= current_date)")"
if [[ "$same_driver_active" != "1" ]]; then
  echo "Concurrent Bolt requests left $same_driver_active active vehicles for one driver"
  exit 1
fi

echo "PASS: Bolt assignment RPC serializes same-vehicle and same-driver races"
