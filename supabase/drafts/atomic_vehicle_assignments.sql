-- Draft only: apply after reviewing on a disposable Supabase database.
-- Replaces the current vehicle/driver assignments in one database transaction.
-- Uses SECURITY INVOKER so the existing RLS policies remain in force.

create or replace function public.s2t_replace_vehicle_assignments(
  p_vehicle_id uuid,
  p_driver_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_requested_count integer := 0;
  v_valid_count integer := 0;
  v_closed_count integer := 0;
  v_inserted_count integer := 0;
  v_driver_ids uuid[] := coalesce(p_driver_ids, '{}'::uuid[]);
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada' using errcode = '42501';
  end if;

  -- Serialize edits to this vehicle before reading or changing its assignments.
  select v.company_id
    into v_company_id
  from public.vehicles v
  where v.id = p_vehicle_id
  for update;

  if v_company_id is null then
    raise exception 'Viatura não encontrada ou sem empresa associada' using errcode = 'P0002';
  end if;

  if not public.s2t_is_admin()
     and not public.s2t_is_company_admin(v_company_id) then
    raise exception 'Sem permissões para gerir as atribuições desta viatura' using errcode = '42501';
  end if;

  select count(*) into v_requested_count
  from unnest(v_driver_ids) as requested(driver_id);

  if v_requested_count <> (
    select count(distinct requested.driver_id)
    from unnest(v_driver_ids) as requested(driver_id)
  ) then
    raise exception 'A lista contém motoristas repetidos' using errcode = '22023';
  end if;

  select count(*) into v_valid_count
  from unnest(v_driver_ids) as requested(driver_id)
  join public.drivers d
    on d.id = requested.driver_id
   and d.company_id = v_company_id
   and coalesce(d.status, 'Ativo') = 'Ativo';

  if v_valid_count <> v_requested_count then
    raise exception 'Todos os motoristas têm de pertencer à empresa da viatura' using errcode = '23514';
  end if;

  -- Lock requested drivers in a stable order. This prevents two concurrent
  -- vehicle edits from assigning the same driver to different vehicles.
  perform d.id
  from public.drivers d
  join unnest(v_driver_ids) as requested(driver_id)
    on requested.driver_id = d.id
  order by d.id
  for update;

  -- Re-check after obtaining row locks: a concurrent driver deactivation may
  -- have committed after the earlier validation but before these locks.
  select count(*) into v_valid_count
  from unnest(v_driver_ids) as requested(driver_id)
  join public.drivers d
    on d.id = requested.driver_id
   and d.company_id = v_company_id
   and coalesce(d.status, 'Ativo') = 'Ativo';

  if v_valid_count <> v_requested_count then
    raise exception 'Só podem ser atribuídos motoristas ativos da mesma empresa da viatura'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.vehicle_assignments va
    join unnest(v_driver_ids) as requested(driver_id)
      on requested.driver_id = va.driver_id
    where va.vehicle_id <> p_vehicle_id
      and va.active_from <= current_date
      and (va.active_until is null or va.active_until >= current_date)
  ) then
    raise exception 'Pelo menos um motorista já está atribuído a outra viatura' using errcode = '23505';
  end if;

  -- Date-only history cannot represent an assignment that starts and ends
  -- on the same day without creating an inverted interval. Refuse that edit
  -- rather than corrupting the historical record; it can be changed tomorrow.
  if exists (
    select 1
    from public.vehicle_assignments va
    where va.vehicle_id = p_vehicle_id
      and va.active_from = current_date
      and (va.active_until is null or va.active_until >= current_date)
      and not (va.driver_id = any(v_driver_ids))
  ) then
    raise exception 'Uma atribuição iniciada hoje não pode ser terminada com segurança usando datas. Tente novamente amanhã.' using errcode = '22023';
  end if;

  -- Preserve completed assignment history; close active rows omitted by the new selection.
  update public.vehicle_assignments va
     set active_until = current_date - 1
   where va.vehicle_id = p_vehicle_id
     and va.active_from <= current_date
     and (va.active_until is null or va.active_until >= current_date)
     and not (va.driver_id = any(v_driver_ids));

  get diagnostics v_closed_count = row_count;

  -- Keep already-active selected assignments; insert only missing ones.
  insert into public.vehicle_assignments (vehicle_id, driver_id, active_from, active_until)
  select p_vehicle_id, requested.driver_id, current_date, null
  from unnest(v_driver_ids) as requested(driver_id)
  where not exists (
    select 1
    from public.vehicle_assignments va
    where va.vehicle_id = p_vehicle_id
      and va.driver_id = requested.driver_id
      and va.active_from <= current_date
      and (va.active_until is null or va.active_until >= current_date)
  )
  on conflict (vehicle_id, driver_id, active_from) do nothing;

  get diagnostics v_inserted_count = row_count;

  return jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'closed_assignments', v_closed_count,
    'created_assignments', v_inserted_count,
    'selected_drivers', v_requested_count
  );
end;
$function$;

revoke all on function public.s2t_replace_vehicle_assignments(uuid, uuid[]) from public, anon;
grant execute on function public.s2t_replace_vehicle_assignments(uuid, uuid[]) to authenticated;

comment on function public.s2t_replace_vehicle_assignments(uuid, uuid[]) is
  'Atomically replaces active vehicle assignments, preserving completed history and enforcing company-admin authorization under RLS.';


-- Deactivate a driver without deleting their identity or assignment history.
-- Uses the same lock order as s2t_replace_vehicle_assignments: vehicles first,
-- then driver. The replace RPC also rejects inactive drivers after acquiring
-- the driver row lock, preventing a concurrent new assignment after deactivation.
create or replace function public.s2t_deactivate_driver(p_driver_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_closed_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada' using errcode = '42501';
  end if;

  -- Lock all vehicles currently associated with this driver in stable order.
  perform v.id
  from public.vehicles v
  join public.vehicle_assignments va on va.vehicle_id = v.id
  where va.driver_id = p_driver_id
    and va.active_from <= current_date
    and (va.active_until is null or va.active_until >= current_date)
  order by v.id
  for update of v;

  -- Then lock the driver row, matching the assignment RPC lock order.
  select d.company_id
    into v_company_id
  from public.drivers d
  where d.id = p_driver_id
  for update;

  if v_company_id is null then
    raise exception 'Motorista não encontrado ou sem empresa associada' using errcode = 'P0002';
  end if;

  if not public.s2t_is_admin()
     and not public.s2t_is_company_admin(v_company_id) then
    raise exception 'Sem permissões para desativar este motorista' using errcode = '42501';
  end if;

  -- Date-only intervals cannot encode a same-day end without an inverted range.
  if exists (
    select 1
    from public.vehicle_assignments va
    where va.driver_id = p_driver_id
      and va.active_from = current_date
      and (va.active_until is null or va.active_until >= current_date)
  ) then
    raise exception 'O motorista tem uma associação iniciada hoje. Para preservar o histórico, a desativação só poderá ser concluída amanhã.'
      using errcode = '22023';
  end if;

  update public.vehicle_assignments va
     set active_until = current_date - 1
   where va.driver_id = p_driver_id
     and va.active_from < current_date
     and (va.active_until is null or va.active_until >= current_date);

  get diagnostics v_closed_count = row_count;

  update public.drivers
     set status = 'Inativo'
   where id = p_driver_id
     and company_id = v_company_id;

  return jsonb_build_object(
    'driver_id', p_driver_id,
    'closed_assignments', v_closed_count,
    'status', 'Inativo'
  );
end;
$function$;

revoke all on function public.s2t_deactivate_driver(uuid) from public, anon;
grant execute on function public.s2t_deactivate_driver(uuid) to authenticated;

comment on function public.s2t_deactivate_driver(uuid) is
  'Atomically deactivates a driver and closes active vehicle assignments without deleting operational history. Refuses same-day interval closure.';
