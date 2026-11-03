-- Read-only preflight for platform import and Uber RPC tenant migrations.
-- SELECT/DO only. Run after company, provider-scope and Uber RPC migrations.

-- 1. All provider history tables must have company_id NOT NULL and no gaps.
select table_name, column_name, is_nullable
from information_schema.columns
where table_schema='public'
  and table_name in (
    'platform_activity_events','platform_trip_records',
    'uber_driver_activity','uber_driver_payments','uber_driver_quality',
    'uber_driver_time_distance','uber_vehicle_performance','uber_vehicle_time_distance'
  )
  and column_name='company_id'
order by table_name;

select 'platform_activity_events' as table_name, count(*) as rows_total,
       count(*) filter(where company_id is null) as rows_without_company
from public.platform_activity_events
union all select 'platform_trip_records',count(*),count(*) filter(where company_id is null) from public.platform_trip_records
union all select 'uber_driver_activity',count(*),count(*) filter(where company_id is null) from public.uber_driver_activity
union all select 'uber_driver_payments',count(*),count(*) filter(where company_id is null) from public.uber_driver_payments
union all select 'uber_driver_quality',count(*),count(*) filter(where company_id is null) from public.uber_driver_quality
union all select 'uber_driver_time_distance',count(*),count(*) filter(where company_id is null) from public.uber_driver_time_distance
union all select 'uber_vehicle_performance',count(*),count(*) filter(where company_id is null) from public.uber_vehicle_performance
union all select 'uber_vehicle_time_distance',count(*),count(*) filter(where company_id is null) from public.uber_vehicle_time_distance;

-- 2. Linked internal identities must belong to the same company as each record.
select 'platform_activity_events' as table_name, count(*) as mismatches
from public.platform_activity_events r
left join public.drivers d on d.id=r.driver_id
left join public.vehicles v on v.id=r.vehicle_id
where (r.driver_id is not null and (d.id is null or r.company_id is distinct from d.company_id))
   or (r.vehicle_id is not null and (v.id is null or r.company_id is distinct from v.company_id))
union all select 'platform_trip_records',count(*) from public.platform_trip_records r
left join public.drivers d on d.id=r.driver_id
left join public.vehicles v on v.id=r.vehicle_id
where (r.driver_id is not null and (d.id is null or r.company_id is distinct from d.company_id))
   or (r.vehicle_id is not null and (v.id is null or r.company_id is distinct from v.company_id))
union all select 'uber_driver_activity',count(*) from public.uber_driver_activity r
left join public.drivers d on d.id=r.driver_id
where r.driver_id is not null and (d.id is null or r.company_id is distinct from d.company_id)
union all select 'uber_driver_payments',count(*) from public.uber_driver_payments r
left join public.drivers d on d.id=r.driver_id
where r.driver_id is not null and (d.id is null or r.company_id is distinct from d.company_id)
union all select 'uber_driver_quality',count(*) from public.uber_driver_quality r
left join public.drivers d on d.id=r.driver_id
where r.driver_id is not null and (d.id is null or r.company_id is distinct from d.company_id)
union all select 'uber_driver_time_distance',count(*) from public.uber_driver_time_distance r
left join public.drivers d on d.id=r.driver_id
where r.driver_id is not null and (d.id is null or r.company_id is distinct from d.company_id)
union all select 'uber_vehicle_performance',count(*) from public.uber_vehicle_performance r
left join public.vehicles v on v.id=r.vehicle_id
where r.vehicle_id is not null and (v.id is null or r.company_id is distinct from v.company_id)
union all select 'uber_vehicle_time_distance',count(*) from public.uber_vehicle_time_distance r
left join public.vehicles v on v.id=r.vehicle_id
where r.vehicle_id is not null and (v.id is null or r.company_id is distinct from v.company_id);

-- 3. Bolt plus all eight Uber privileged RPCs must remain SECURITY DEFINER,
-- pin the empty search_path and be executable only by service_role.
do $preflight$
declare
  rpc_count integer;
begin
  select count(*) into rpc_count
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in (
      'sync_bolt_activity','sync_uber_driver_status','sync_uber_driver_activity',
      'sync_uber_driver_payments','sync_uber_driver_quality',
      'sync_uber_driver_time_distance','sync_uber_vehicle_performance',
      'sync_uber_vehicle_time_distance','sync_uber_trip_activity'
    );

  if rpc_count <> 9 then
    raise exception 'Expected all nine platform import RPCs; found %', rpc_count;
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'sync_bolt_activity','sync_uber_driver_status','sync_uber_driver_activity',
        'sync_uber_driver_payments','sync_uber_driver_quality',
        'sync_uber_driver_time_distance','sync_uber_vehicle_performance',
        'sync_uber_vehicle_time_distance','sync_uber_trip_activity'
      )
      and (
        not p.prosecdef
        or not coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']::text[]
        or not has_function_privilege('service_role', p.oid, 'EXECUTE')
        or has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ) then
    raise exception 'A platform import RPC has an unsafe execution setting or grant';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='sync_uber_trip_activity'
      and pg_get_functiondef(p.oid) like
        '%Uber trip contains a driver or vehicle outside the S2T company%'
  ) then
    raise exception 'Uber trip RPC is missing its tenant ownership guard';
  end if;
end;
$preflight$;

-- Detailed function settings remain visible for an operator to inspect.
select p.proname, p.prosecdef, p.proconfig,
       pg_get_userbyid(p.proowner) as owner,
       coalesce(array_to_string(p.proacl, ', '),'(default ACL)') as acl,
       pg_get_functiondef(p.oid) like '%company_id%' as definition_mentions_company
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
    'sync_bolt_activity','sync_uber_driver_status','sync_uber_driver_activity',
    'sync_uber_driver_payments','sync_uber_driver_quality',
    'sync_uber_driver_time_distance','sync_uber_vehicle_performance',
    'sync_uber_vehicle_time_distance','sync_uber_trip_activity'
  )
order by p.proname;

-- 4. Tenant-scoped unique conflict keys replace legacy global provider keys.
select tablename,indexname,indexdef
from pg_indexes
where schemaname='public'
  and tablename in (
    'platform_activity_events','platform_trip_records',
    'uber_driver_activity','uber_driver_payments','uber_driver_quality',
    'uber_driver_time_distance','uber_vehicle_performance','uber_vehicle_time_distance'
  )
  and indexdef ilike '%unique%'
order by tablename,indexname;
