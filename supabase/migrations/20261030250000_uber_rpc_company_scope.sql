-- Simplicity2Take Fleet — tenant-safe Uber report RPCs.
-- DRAFT ONLY. Requires 20261030240000_platform_import_company_scope.sql
-- and the company foundation migration. Do not deploy until tested on staging.
--
-- Uber import remains a trusted S2T global-admin workflow. The tenant is resolved
-- server-side from companies.slug; no company_id is accepted from imported CSV data.
-- All UUID/plate matching is tenant-scoped, and global unique-key conflicts can
-- update only rows already owned by the same tenant.

create or replace function public.sync_uber_driver_status(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  r jsonb;
  matched_count integer := 0;
  created_count integer := 0;
  skipped_count integer := 0;
  v_company_id uuid;
  v_driver_id uuid;
  v_uuid text;
  v_status text;
  v_name text;
  v_email text;
  v_phone text;
  v_last_online timestamptz;
  v_realtime text;
  v_observed_at timestamptz;
  v_match_count integer;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;

  select id into v_company_id
  from public.companies
  where slug = 'simplicity2take' and status = 'Ativa'
  limit 1;
  if v_company_id is null then raise exception 'S2T company is not configured'; end if;

  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_uuid := nullif(trim(r->>'uber_driver_uuid'), '');
    v_status := upper(nullif(trim(r->>'status'), ''));
    v_name := nullif(trim(r->>'full_name'), '');
    v_email := nullif(lower(trim(r->>'email')), '');
    v_phone := nullif(trim(r->>'phone'), '');
    v_realtime := upper(nullif(trim(r->>'realtime_status'), ''));

    if v_uuid is null or v_status is null or v_status not in ('ACTIVE','ACCEPTED') then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    begin
      v_last_online := nullif(r->>'last_online_at', '')::timestamptz;
    exception when others then
      v_last_online := null;
    end;

    begin
      v_observed_at := coalesce(nullif(r->>'observed_at','')::timestamptz, now());
    exception when others then
      v_observed_at := now();
    end;

    v_driver_id := null;
    -- Prefer an exact Uber UUID. If falling back to email/phone, require one
    -- unambiguous S2T match rather than selecting an arbitrary driver.
    select id into v_driver_id
    from public.drivers
    where company_id = v_company_id and uber_driver_uuid = v_uuid
    limit 1;

    if v_driver_id is null then
      select count(distinct id) into v_match_count
      from public.drivers
      where company_id = v_company_id
        and (
          (v_email is not null and lower(coalesce(email,'')) = v_email)
          or (v_phone is not null and regexp_replace(coalesce(phone,''),'[^0-9]','','g') =
            regexp_replace(v_phone,'[^0-9]','','g'))
        );
      if v_match_count > 1 then
        skipped_count := skipped_count + 1;
        continue;
      end if;
      if v_match_count = 1 then
        select id into v_driver_id
        from public.drivers
        where company_id = v_company_id
          and (
            (v_email is not null and lower(coalesce(email,'')) = v_email)
            or (v_phone is not null and regexp_replace(coalesce(phone,''),'[^0-9]','','g') =
              regexp_replace(v_phone,'[^0-9]','','g'))
          )
        limit 1;
      end if;
    end if;

    if v_driver_id is null then
      insert into public.drivers(
        company_id, full_name, email, phone, status, uber_driver_uuid,
        uber_status, uber_realtime_status, uber_status_at, uber_last_online_at,
        uber_status_raw, uber_last_synced_at
      )
      values (
        v_company_id, coalesce(v_name,'Motorista Uber'), v_email, v_phone, 'Ativo',
        v_uuid, v_status, v_realtime,
        v_observed_at,
        v_last_online, coalesce(r->'raw','{}'::jsonb), now()
      )
      returning id into v_driver_id;
      created_count := created_count + 1;
    else
      update public.drivers
      set full_name = coalesce(v_name,full_name),
          email = coalesce(v_email,email),
          phone = coalesce(v_phone,phone),
          status = 'Ativo',
          uber_driver_uuid = v_uuid,
          uber_status = v_status,
          uber_realtime_status = v_realtime,
          uber_status_at = v_observed_at,
          uber_last_online_at = v_last_online,
          uber_status_raw = coalesce(r->'raw','{}'::jsonb),
          uber_last_synced_at = now(),
          updated_at = now()
      where id = v_driver_id and company_id = v_company_id;
      matched_count := matched_count + 1;
    end if;
  end loop;

  return jsonb_build_object('matched',matched_count,'created',created_count,'skipped',skipped_count);
end;
$function$;

create or replace function public.sync_uber_driver_activity(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  r jsonb; n integer := 0; d_id uuid; v_company_id uuid; v_uuid text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service_role required' using errcode='42501'; end if;
  select id into v_company_id from public.companies where slug='simplicity2take' and status='Ativa' limit 1;
  if v_company_id is null then raise exception 'S2T company is not configured'; end if;
  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_uuid := nullif(trim(r->>'uber_driver_uuid'),'');
    if v_uuid is null then continue; end if;
    select id into d_id from public.drivers where uber_driver_uuid=v_uuid and company_id=v_company_id limit 1;
    insert into public.uber_driver_activity(company_id,driver_id,uber_driver_uuid,driver_name,completed_trips,online_duration_minutes,trip_duration_minutes,period_start,period_end,raw)
    values(v_company_id,d_id,v_uuid,nullif(r->>'driver_name',''),nullif(r->>'completed_trips','')::integer,
      nullif(r->>'online_duration_minutes','')::integer,nullif(r->>'trip_duration_minutes','')::integer,
      nullif(r->>'period_start','')::date,nullif(r->>'period_end','')::date,coalesce(r->'raw','{}'::jsonb))
    on conflict(uber_driver_uuid,period_start,period_end) do update set
      driver_id=excluded.driver_id,driver_name=excluded.driver_name,completed_trips=excluded.completed_trips,
      online_duration_minutes=excluded.online_duration_minutes,trip_duration_minutes=excluded.trip_duration_minutes,
      raw=excluded.raw,imported_at=now()
    where public.uber_driver_activity.company_id=excluded.company_id;
    get diagnostics affected = row_count;
    n:=n+affected;
  end loop;
  return jsonb_build_object('saved',n);
end;
$function$;

create or replace function public.sync_uber_driver_payments(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare r jsonb; n integer:=0; affected integer:=0; d_id uuid; v_company_id uuid; v_uuid text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service_role required' using errcode='42501'; end if;
  select id into v_company_id from public.companies where slug='simplicity2take' and status='Ativa' limit 1;
  if v_company_id is null then raise exception 'S2T company is not configured'; end if;
  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_uuid:=nullif(trim(r->>'uber_driver_uuid'),''); if v_uuid is null then continue; end if;
    select id into d_id from public.drivers where uber_driver_uuid=v_uuid and company_id=v_company_id limit 1;
    insert into public.uber_driver_payments(company_id,driver_id,uber_driver_uuid,driver_name,paid_to_you,earnings,cash_received,fare,taxes,service_fee,tolls,tips,adjustments,period_start,period_end,raw,imported_at)
    values(v_company_id,d_id,v_uuid,r->>'driver_name',(r->>'paid_to_you')::numeric,(r->>'earnings')::numeric,
      (r->>'cash_received')::numeric,(r->>'fare')::numeric,(r->>'taxes')::numeric,(r->>'service_fee')::numeric,
      (r->>'tolls')::numeric,(r->>'tips')::numeric,(r->>'adjustments')::numeric,
      (r->>'period_start')::date,(r->>'period_end')::date,coalesce(r->'raw','{}'::jsonb),now())
    on conflict(uber_driver_uuid,period_start,period_end) do update set
      driver_id=excluded.driver_id,driver_name=excluded.driver_name,paid_to_you=excluded.paid_to_you,
      earnings=excluded.earnings,cash_received=excluded.cash_received,fare=excluded.fare,taxes=excluded.taxes,
      service_fee=excluded.service_fee,tolls=excluded.tolls,tips=excluded.tips,adjustments=excluded.adjustments,
      raw=excluded.raw,imported_at=now()
    where public.uber_driver_payments.company_id=excluded.company_id;
    get diagnostics affected = row_count;
    n:=n+affected;
  end loop;
  return jsonb_build_object('saved',n);
end;
$function$;

create or replace function public.sync_uber_driver_quality(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare r jsonb; n integer:=0; affected integer:=0; d_id uuid; v_company_id uuid; v_uuid text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service_role required' using errcode='42501'; end if;
  select id into v_company_id from public.companies where slug='simplicity2take' and status='Ativa' limit 1;
  if v_company_id is null then raise exception 'S2T company is not configured'; end if;
  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_uuid:=nullif(trim(r->>'uber_driver_uuid'),''); if v_uuid is null then continue; end if;
    select id into d_id from public.drivers where uber_driver_uuid=v_uuid and company_id=v_company_id limit 1;
    insert into public.uber_driver_quality(company_id,driver_id,uber_driver_uuid,driver_name,completed_trips,acceptance_rate,cancellation_rate,completion_rate,rating_last_4_weeks,rating_last_500_trips,current_acceptance_rate,current_cancellation_rate,accepted_trips,rejected_trips,cancelled_trips,driver_cancelled_trips,failed_trips,total_trip_assignments,period_start,period_end,raw,imported_at)
    values(v_company_id,d_id,v_uuid,r->>'driver_name',(r->>'completed_trips')::int,(r->>'acceptance_rate')::numeric,
      (r->>'cancellation_rate')::numeric,(r->>'completion_rate')::numeric,(r->>'rating_last_4_weeks')::numeric,
      (r->>'rating_last_500_trips')::numeric,(r->>'current_acceptance_rate')::numeric,
      (r->>'current_cancellation_rate')::numeric,(r->>'accepted_trips')::int,(r->>'rejected_trips')::int,
      (r->>'cancelled_trips')::int,(r->>'driver_cancelled_trips')::int,(r->>'failed_trips')::int,
      (r->>'total_trip_assignments')::int,(r->>'period_start')::date,(r->>'period_end')::date,
      coalesce(r->'raw','{}'::jsonb),now())
    on conflict(uber_driver_uuid,period_start,period_end) do update set
      driver_id=excluded.driver_id,driver_name=excluded.driver_name,completed_trips=excluded.completed_trips,
      acceptance_rate=excluded.acceptance_rate,cancellation_rate=excluded.cancellation_rate,
      completion_rate=excluded.completion_rate,rating_last_4_weeks=excluded.rating_last_4_weeks,
      rating_last_500_trips=excluded.rating_last_500_trips,current_acceptance_rate=excluded.current_acceptance_rate,
      current_cancellation_rate=excluded.current_cancellation_rate,accepted_trips=excluded.accepted_trips,
      rejected_trips=excluded.rejected_trips,cancelled_trips=excluded.cancelled_trips,
      driver_cancelled_trips=excluded.driver_cancelled_trips,failed_trips=excluded.failed_trips,
      total_trip_assignments=excluded.total_trip_assignments,raw=excluded.raw,imported_at=now()
    where public.uber_driver_quality.company_id=excluded.company_id;
    get diagnostics affected = row_count;
    n:=n+affected;
  end loop;
  return jsonb_build_object('saved',n);
end;
$function$;

create or replace function public.sync_uber_driver_time_distance(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare r jsonb; n integer:=0; affected integer:=0; d_id uuid; v_company_id uuid; v_uuid text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service_role required' using errcode='42501'; end if;
  select id into v_company_id from public.companies where slug='simplicity2take' and status='Ativa' limit 1;
  if v_company_id is null then raise exception 'S2T company is not configured'; end if;
  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_uuid:=nullif(trim(r->>'uber_driver_uuid'),''); if v_uuid is null then continue; end if;
    select id into d_id from public.drivers where uber_driver_uuid=v_uuid and company_id=v_company_id limit 1;
    insert into public.uber_driver_time_distance(company_id,driver_id,uber_driver_uuid,driver_name,opening_minutes,route_minutes,trip_minutes,unavailable_minutes,free_distance_km,route_distance_km,trip_distance_km,unavailable_distance_km,period_start,period_end,raw,imported_at)
    values(v_company_id,d_id,v_uuid,r->>'driver_name',(r->>'opening_minutes')::int,(r->>'route_minutes')::int,
      (r->>'trip_minutes')::int,(r->>'unavailable_minutes')::int,(r->>'free_distance_km')::numeric,
      (r->>'route_distance_km')::numeric,(r->>'trip_distance_km')::numeric,
      (r->>'unavailable_distance_km')::numeric,(r->>'period_start')::date,(r->>'period_end')::date,
      coalesce(r->'raw','{}'::jsonb),now())
    on conflict(uber_driver_uuid,period_start,period_end) do update set
      driver_id=excluded.driver_id,driver_name=excluded.driver_name,opening_minutes=excluded.opening_minutes,
      route_minutes=excluded.route_minutes,trip_minutes=excluded.trip_minutes,unavailable_minutes=excluded.unavailable_minutes,
      free_distance_km=excluded.free_distance_km,route_distance_km=excluded.route_distance_km,
      trip_distance_km=excluded.trip_distance_km,unavailable_distance_km=excluded.unavailable_distance_km,
      raw=excluded.raw,imported_at=now()
    where public.uber_driver_time_distance.company_id=excluded.company_id;
    get diagnostics affected = row_count;
    n:=n+affected;
  end loop;
  return jsonb_build_object('saved',n);
end;
$function$;

create or replace function public.sync_uber_vehicle_performance(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare r jsonb; n integer:=0; affected integer:=0; v_id uuid; v_company_id uuid; v_uuid text; v_plate text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service_role required' using errcode='42501'; end if;
  select id into v_company_id from public.companies where slug='simplicity2take' and status='Ativa' limit 1;
  if v_company_id is null then raise exception 'S2T company is not configured'; end if;
  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_uuid:=nullif(trim(r->>'uber_vehicle_uuid'),''); v_plate:=upper(trim(coalesce(r->>'plate','')));
    v_id:=null;
    if v_uuid is not null then select id into v_id from public.vehicles where uber_vehicle_uuid=v_uuid and company_id=v_company_id limit 1; end if;
    if v_id is null and v_plate<>'' then select id into v_id from public.vehicles where upper(plate)=v_plate and company_id=v_company_id limit 1; end if;
    insert into public.uber_vehicle_performance(company_id,vehicle_id,uber_vehicle_uuid,plate,total_earnings,earnings_per_hour,cash_received,trips_per_hour,online_hours,trip_hours,work_hours,total_trips,acceptance_rate,cancellation_rate,accepted_trips,rejected_trips,cancelled_trips,failed_trips,total_trip_assignments,period_start,period_end,raw,imported_at)
    values(v_company_id,v_id,r->>'uber_vehicle_uuid',r->>'plate',(r->>'total_earnings')::numeric,
      (r->>'earnings_per_hour')::numeric,(r->>'cash_received')::numeric,(r->>'trips_per_hour')::numeric,
      (r->>'online_hours')::numeric,(r->>'trip_hours')::numeric,(r->>'work_hours')::numeric,
      (r->>'total_trips')::int,(r->>'acceptance_rate')::numeric,(r->>'cancellation_rate')::numeric,
      (r->>'accepted_trips')::int,(r->>'rejected_trips')::int,(r->>'cancelled_trips')::int,
      (r->>'failed_trips')::int,(r->>'total_trip_assignments')::int,(r->>'period_start')::date,
      (r->>'period_end')::date,coalesce(r->'raw','{}'::jsonb),now())
    on conflict(uber_vehicle_uuid,period_start,period_end) do update set
      vehicle_id=excluded.vehicle_id,plate=excluded.plate,total_earnings=excluded.total_earnings,
      earnings_per_hour=excluded.earnings_per_hour,cash_received=excluded.cash_received,
      trips_per_hour=excluded.trips_per_hour,online_hours=excluded.online_hours,trip_hours=excluded.trip_hours,
      work_hours=excluded.work_hours,total_trips=excluded.total_trips,acceptance_rate=excluded.acceptance_rate,
      cancellation_rate=excluded.cancellation_rate,accepted_trips=excluded.accepted_trips,
      rejected_trips=excluded.rejected_trips,cancelled_trips=excluded.cancelled_trips,
      failed_trips=excluded.failed_trips,total_trip_assignments=excluded.total_trip_assignments,
      raw=excluded.raw,imported_at=now()
    where public.uber_vehicle_performance.company_id=excluded.company_id;
    get diagnostics affected = row_count;
    n:=n+affected;
  end loop;
  return jsonb_build_object('saved',n);
end;
$function$;

create or replace function public.sync_uber_vehicle_time_distance(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare r jsonb; n integer:=0; affected integer:=0; v_id uuid; v_company_id uuid; v_uuid text; v_plate text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service_role required' using errcode='42501'; end if;
  select id into v_company_id from public.companies where slug='simplicity2take' and status='Ativa' limit 1;
  if v_company_id is null then raise exception 'S2T company is not configured'; end if;
  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_uuid:=nullif(trim(r->>'uber_vehicle_uuid'),''); v_plate:=upper(trim(coalesce(r->>'plate','')));
    v_id:=null;
    if v_uuid is not null then select id into v_id from public.vehicles where uber_vehicle_uuid=v_uuid and company_id=v_company_id limit 1; end if;
    if v_id is null and v_plate<>'' then select id into v_id from public.vehicles where upper(plate)=v_plate and company_id=v_company_id limit 1; end if;
    insert into public.uber_vehicle_time_distance(company_id,vehicle_id,uber_vehicle_uuid,plate,opening_minutes,route_minutes,trip_minutes,unavailable_minutes,free_distance_km,route_distance_km,trip_distance_km,unavailable_distance_km,period_start,period_end,raw,imported_at)
    values(v_company_id,v_id,r->>'uber_vehicle_uuid',r->>'plate',(r->>'opening_minutes')::int,
      (r->>'route_minutes')::int,(r->>'trip_minutes')::int,(r->>'unavailable_minutes')::int,
      (r->>'free_distance_km')::numeric,(r->>'route_distance_km')::numeric,
      (r->>'trip_distance_km')::numeric,(r->>'unavailable_distance_km')::numeric,
      (r->>'period_start')::date,(r->>'period_end')::date,coalesce(r->'raw','{}'::jsonb),now())
    on conflict(uber_vehicle_uuid,period_start,period_end) do update set
      vehicle_id=excluded.vehicle_id,plate=excluded.plate,opening_minutes=excluded.opening_minutes,
      route_minutes=excluded.route_minutes,trip_minutes=excluded.trip_minutes,
      unavailable_minutes=excluded.unavailable_minutes,free_distance_km=excluded.free_distance_km,
      route_distance_km=excluded.route_distance_km,trip_distance_km=excluded.trip_distance_km,
      unavailable_distance_km=excluded.unavailable_distance_km,raw=excluded.raw,imported_at=now()
    where public.uber_vehicle_time_distance.company_id=excluded.company_id;
    get diagnostics affected = row_count;
    n:=n+affected;
  end loop;
  return jsonb_build_object('saved',n);
end;
$function$;

-- The preceding platform-import migration backfills every legacy report row.
-- Require ownership on all Uber report records before these RPCs are enabled.
alter table public.uber_driver_activity alter column company_id set not null;
alter table public.uber_driver_payments alter column company_id set not null;
alter table public.uber_driver_quality alter column company_id set not null;
alter table public.uber_driver_time_distance alter column company_id set not null;
alter table public.uber_vehicle_performance alter column company_id set not null;
alter table public.uber_vehicle_time_distance alter column company_id set not null;

-- Keep these privileged import RPCs callable only by the server-side service role.
revoke all on function public.sync_uber_driver_status(jsonb) from public, anon, authenticated;
revoke all on function public.sync_uber_driver_activity(jsonb) from public, anon, authenticated;
revoke all on function public.sync_uber_driver_payments(jsonb) from public, anon, authenticated;
revoke all on function public.sync_uber_driver_quality(jsonb) from public, anon, authenticated;
revoke all on function public.sync_uber_driver_time_distance(jsonb) from public, anon, authenticated;
revoke all on function public.sync_uber_vehicle_performance(jsonb) from public, anon, authenticated;
revoke all on function public.sync_uber_vehicle_time_distance(jsonb) from public, anon, authenticated;
grant execute on function public.sync_uber_driver_status(jsonb) to service_role;
grant execute on function public.sync_uber_driver_activity(jsonb) to service_role;
grant execute on function public.sync_uber_driver_payments(jsonb) to service_role;
grant execute on function public.sync_uber_driver_quality(jsonb) to service_role;
grant execute on function public.sync_uber_driver_time_distance(jsonb) to service_role;
grant execute on function public.sync_uber_vehicle_performance(jsonb) to service_role;
grant execute on function public.sync_uber_vehicle_time_distance(jsonb) to service_role;

comment on function public.sync_uber_driver_status(jsonb) is 'S2T-only Uber status import; identity matching is scoped to the trusted S2T company.';
comment on function public.sync_uber_driver_activity(jsonb) is 'S2T-only Uber report import; driver matching and conflict updates are tenant-scoped.';
comment on function public.sync_uber_driver_payments(jsonb) is 'S2T-only Uber report import; driver matching and conflict updates are tenant-scoped.';
comment on function public.sync_uber_driver_quality(jsonb) is 'S2T-only Uber report import; driver matching and conflict updates are tenant-scoped.';
comment on function public.sync_uber_driver_time_distance(jsonb) is 'S2T-only Uber report import; driver matching and conflict updates are tenant-scoped.';
comment on function public.sync_uber_vehicle_performance(jsonb) is 'S2T-only Uber report import; vehicle UUID/plate matching and conflict updates are tenant-scoped.';
comment on function public.sync_uber_vehicle_time_distance(jsonb) is 'S2T-only Uber report import; vehicle UUID/plate matching and conflict updates are tenant-scoped.';
