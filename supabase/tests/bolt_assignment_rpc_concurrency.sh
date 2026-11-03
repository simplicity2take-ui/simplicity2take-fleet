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

# Concurrent full snapshots with the same provider identities remain atomic.
atomic_company_id="$(psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT id FROM public.companies WHERE slug='simplicity2take' AND status='Ativa'")"
atomic_blocker_log="$work_dir/atomic-blocker.log"
atomic_a_log="$work_dir/atomic-a.log"
atomic_b_log="$work_dir/atomic-b.log"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$atomic_blocker_log" 2>&1 <<'SQL' &
BEGIN;
LOCK TABLE public.vehicle_assignments IN ROW EXCLUSIVE MODE;
SELECT pg_sleep(2);
COMMIT;
SQL
atomic_blocker_pid=$!
sleep 0.2

atomic_sync_a="SELECT public.s2t_apply_bolt_fleet_sync(
  '$atomic_company_id'::uuid,
  jsonb_build_array(jsonb_build_object(
    'id','30000000-0000-0000-0000-000000000030','is_new',true,
    'plate','AT-30-AT','brand','Toyota','model','Yaris','vehicle_year',2024,
    'status','Ativo','bolt_vehicle_uuid','atomic-race-bolt-vehicle'
  )),
  jsonb_build_array(jsonb_build_object(
    'id','20000000-0000-0000-0000-000000000030','is_new',true,
    'full_name','Atomic Race Driver','email','atomic-race@example.test','phone','910000030',
    'status','Ativo','bolt_driver_uuid','atomic-race-bolt-driver',
    'assigned_vehicle_id','30000000-0000-0000-0000-000000000030'
  )),
  now()
);'
atomic_sync_b="SELECT public.s2t_apply_bolt_fleet_sync(
  '$atomic_company_id'::uuid,
  jsonb_build_array(jsonb_build_object(
    'id','30000000-0000-0000-0000-000000000031','is_new',true,
    'plate','AT-31-AT','brand','Toyota','model','Yaris','vehicle_year',2024,
    'status','Ativo','bolt_vehicle_uuid','atomic-race-bolt-vehicle'
  )),
  jsonb_build_array(jsonb_build_object(
    'id','20000000-0000-0000-0000-000000000031','is_new',true,
    'full_name','Atomic Race Driver','email','atomic-race@example.test','phone','910000031',
    'status','Ativo','bolt_driver_uuid','atomic-race-bolt-driver',
    'assigned_vehicle_id','30000000-0000-0000-0000-000000000031'
  )),
  now()
);'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq >"$atomic_a_log" 2>&1 <<SQL &
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
$atomic_sync_a
COMMIT;
SQL
atomic_a_pid=$!
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq >"$atomic_b_log" 2>&1 <<SQL &
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('company_id','$atomic_company_id',true);
$atomic_sync_b
COMMIT;
SQL
atomic_b_pid=$!
wait_for_lock_waiters 2
wait "$atomic_blocker_pid"
set +e
wait "$atomic_a_pid"; atomic_rc_a=$?
wait "$atomic_b_pid"; atomic_rc_b=$?
set -e
if [[ "$atomic_rc_a" -eq 0 && "$atomic_rc_b" -ne 0 ]]; then
  atomic_loser_log="$atomic_b_log"
elif [[ "$atomic_rc_b" -eq 0 && "$atomic_rc_a" -ne 0 ]]; then
  atomic_loser_log="$atomic_a_log"
else
  cat "$atomic_a_log" "$atomic_b_log"
  echo "Expected one concurrent Bolt snapshot to commit and one to roll back"
  exit 1
fi
if ! grep -Eiq "duplicate key value violates unique constraint" "$atomic_loser_log"; then
  cat "$atomic_a_log" "$atomic_b_log"
  echo "The losing concurrent Bolt snapshot did not fail on the duplicate provider identity"
  exit 1
fi
atomic_vehicle_count="$(psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.vehicles WHERE bolt_vehicle_uuid='atomic-race-bolt-vehicle'")"
atomic_driver_count="$(psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.drivers WHERE bolt_driver_uuid='atomic-race-bolt-driver'")"
atomic_assignment_count="$(psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.vehicle_assignments va JOIN public.drivers d ON d.id=va.driver_id JOIN public.vehicles v ON v.id=va.vehicle_id WHERE d.bolt_driver_uuid='atomic-race-bolt-driver' AND v.bolt_vehicle_uuid='atomic-race-bolt-vehicle'")"
if [[ "$atomic_vehicle_count" != "1" || "$atomic_driver_count" != "1" || "$atomic_assignment_count" != "1" ]]; then
  echo "Concurrent Bolt sync left duplicates or partial fleet data ($atomic_vehicle_count vehicles, $atomic_driver_count drivers, $atomic_assignment_count assignments)"
  exit 1
fi

echo "PASS: concurrent Bolt fleet snapshots serialize without duplicates or partial writes"

