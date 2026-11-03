-- Simplicity2Take Fleet — protect driver identity and assignment history.
-- Depends on company_fleet_foundation, company_memberships_and_integrity and company_fleet_rls.
-- This migration is exercised against a disposable PostgreSQL database in CI.
-- Protects driver account linkage and prevents API-role deletion of assignment history.
-- Company ownership changes serialize with every assignment writer before
-- any driver/vehicle row lock is taken. This prevents transfer/assignment races.
create or replace function public.s2t_lock_assignment_history_for_ownership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  lock table public.vehicle_assignments in share row exclusive mode;
  return null;
end;
$function$;

drop trigger if exists s2t_drivers_company_transfer_mutex on public.drivers;
create trigger s2t_drivers_company_transfer_mutex
before update of company_id on public.drivers
for each statement execute function public.s2t_lock_assignment_history_for_ownership_change();

drop trigger if exists s2t_vehicles_company_transfer_mutex on public.vehicles;
create trigger s2t_vehicles_company_transfer_mutex
before update of company_id on public.vehicles
for each statement execute function public.s2t_lock_assignment_history_for_ownership_change();

-- Ownership transfers that would reinterpret assignment history fail closed.
-- Unassigned entities remain correctable by a global administrator.
create or replace function public.s2t_guard_company_ownership_change()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if new.company_id is distinct from old.company_id then
    if not public.s2t_is_admin() then
      raise exception 'Alteração da empresa proprietária reservada ao administrador global'
        using errcode = '42501';
    end if;

    if tg_table_name = 'drivers' then
      if exists (
        select 1 from public.vehicle_assignments va where va.driver_id = old.id
      ) then
        raise exception 'Transferência recusada: o motorista tem histórico de atribuições'
          using errcode = '23514';
      end if;
    elsif tg_table_name = 'vehicles' then
      if exists (
        select 1 from public.vehicle_assignments va where va.vehicle_id = old.id
      ) then
        raise exception 'Transferência recusada: a viatura tem histórico de atribuições'
          using errcode = '23514';
      end if;
    end if;
  end if;

  if tg_table_name = 'drivers'
     and new.profile_id is distinct from old.profile_id
     and not public.s2t_is_admin() then
    raise exception 'Alteração da conta associada ao motorista reservada ao administrador global'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists s2t_drivers_company_ownership_guard on public.drivers;
create trigger s2t_drivers_company_ownership_guard
before update of company_id, profile_id on public.drivers
for each row execute function public.s2t_guard_company_ownership_change();

drop trigger if exists s2t_vehicles_company_ownership_guard on public.vehicles;
create trigger s2t_vehicles_company_ownership_guard
before update of company_id on public.vehicles
for each row execute function public.s2t_guard_company_ownership_change();

-- Assignment rows are operational history. Only the authorized transactional RPCs
-- may write them; API roles cannot delete or directly edit assignment intervals.
drop policy if exists "s2t assignments company admin insert" on public.vehicle_assignments;
drop policy if exists "s2t assignments company admin update" on public.vehicle_assignments;
drop policy if exists "s2t assignments company admin delete" on public.vehicle_assignments;
revoke insert, update, delete on table public.vehicle_assignments from public, anon, authenticated;

-- Parent rows must not be hard-deleted either: their existing foreign keys use
-- ON DELETE CASCADE and would otherwise erase assignment history indirectly.
drop policy if exists "s2t drivers global admin delete" on public.drivers;
drop policy if exists "s2t vehicles global admin delete" on public.vehicles;
revoke delete on table public.drivers from public, anon, authenticated;
revoke delete on table public.vehicles from public, anon, authenticated;

comment on function public.s2t_guard_company_ownership_change() is
  'Trigger-only guard: only global admins may change company ownership or drivers.profile_id.';
comment on table public.vehicle_assignments is
  'Assignment history: API roles cannot delete rows; corrections preserve history by closing intervals or inserting new rows.';

create or replace function public.s2t_guard_assignment_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  driver_company uuid;
  driver_status text;
  vehicle_company uuid;
  vehicle_status text;
begin
  if new.driver_id is null or new.vehicle_id is null then
    raise exception 'Atribuição recusada: motorista e viatura são obrigatórios'
      using errcode = '23502';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('s2t-driver:' || new.driver_id::text, 0)
  );

  select v.company_id, v.status into vehicle_company, vehicle_status
  from public.vehicles v
  where v.id = new.vehicle_id
  for key share;

  select d.company_id, d.status into driver_company, driver_status
  from public.drivers d
  where d.id = new.driver_id
  for key share;

  if driver_company is null or vehicle_company is null then
    raise exception 'Atribuição recusada: empresa do motorista ou da viatura não definida'
      using errcode = '23514';
  end if;

  if driver_company <> vehicle_company then
    raise exception 'Atribuição recusada: motorista e viatura pertencem a empresas diferentes'
      using errcode = '23514';
  end if;

  if coalesce(driver_status, 'Ativo') <> 'Ativo' then
    raise exception 'Atribuição recusada: só motoristas ativos podem ser associados'
      using errcode = '23514';
  end if;

  if coalesce(vehicle_status, 'Ativo') <> 'Ativo' then
    raise exception 'Atribuição recusada: só viaturas ativas podem receber associações'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function public.s2t_guard_assignment_company() from public, anon, authenticated;

drop trigger if exists s2t_assignment_company_guard on public.vehicle_assignments;
create trigger s2t_assignment_company_guard
before insert or update of driver_id, vehicle_id
on public.vehicle_assignments
for each row execute function public.s2t_guard_assignment_company();

create or replace function public.s2t_guard_inactive_parent_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status is distinct from old.status and new.status = 'Inativo' then
    if tg_table_name = 'drivers' and exists (
      select 1 from public.vehicle_assignments va
      where va.driver_id = new.id
        and (va.active_until is null or va.active_until >= current_date)
    ) then
      raise exception 'Não é possível desativar o motorista enquanto existirem associações ativas ou futuras'
        using errcode = '23514';
    end if;

    if tg_table_name = 'vehicles' and exists (
      select 1 from public.vehicle_assignments va
      where va.vehicle_id = new.id
        and (va.active_until is null or va.active_until >= current_date)
    ) then
      raise exception 'Não é possível arquivar a viatura enquanto existirem associações ativas ou futuras'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.s2t_guard_inactive_parent_status() from public, anon, authenticated;

drop trigger if exists s2t_driver_inactive_status_guard on public.drivers;
create trigger s2t_driver_inactive_status_guard
before update of status on public.drivers
for each row execute function public.s2t_guard_inactive_parent_status();

drop trigger if exists s2t_vehicle_inactive_status_guard on public.vehicles;
create trigger s2t_vehicle_inactive_status_guard
before update of status on public.vehicles
for each row execute function public.s2t_guard_inactive_parent_status();

create or replace function public.s2t_replace_vehicle_assignments(
  p_vehicle_id uuid,
  p_driver_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_vehicle_status text;
  v_requested_count integer := 0;
  v_valid_count integer := 0;
  v_closed_count integer := 0;
  v_inserted_count integer := 0;
  v_driver_ids uuid[] := coalesce(p_driver_ids, '{}'::uuid[]);
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada' using errcode = '42501';
  end if;

  -- Acquire the assignment-table mutex before driver/vehicle locks to keep one lock order.
  lock table public.vehicle_assignments in share row exclusive mode;

  -- Serialize edits to each requested driver before locking the vehicle. The same
  -- lock is acquired by the deactivation RPC and assignment integrity trigger.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('s2t-driver:' || requested.driver_id::text, 0)
  )
  from (
    select distinct requested.driver_id
    from unnest(v_driver_ids) as requested(driver_id)
    where requested.driver_id is not null
    order by requested.driver_id
  ) requested;

  -- Verify access before taking a row lock, then lock and recheck state.
  select v.company_id, v.status
    into v_company_id, v_vehicle_status
  from public.vehicles v
  where v.id = p_vehicle_id;

  if v_company_id is null then
    raise exception 'Viatura não encontrada ou sem empresa associada' using errcode = 'P0002';
  end if;
  if not public.s2t_is_admin()
     and not public.s2t_is_company_admin(v_company_id) then
    raise exception 'Viatura não encontrada ou sem empresa associada' using errcode = 'P0002';
  end if;

  select v.company_id, v.status
    into v_company_id, v_vehicle_status
  from public.vehicles v
  where v.id = p_vehicle_id
  for update;

  if v_company_id is null then
    raise exception 'Viatura não encontrada ou sem empresa associada' using errcode = 'P0002';
  end if;
  if not public.s2t_is_admin()
     and not public.s2t_is_company_admin(v_company_id) then
    raise exception 'Viatura não encontrada ou sem empresa associada' using errcode = 'P0002';
  end if;
  if coalesce(v_vehicle_status, 'Ativo') <> 'Ativo' then
    raise exception 'Não é possível atribuir motoristas a uma viatura inativa ou arquivada' using errcode = '23514';
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
   and d.company_id = v_company_id;

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
      and (va.active_until is null or va.active_until >= current_date)
  ) then
    raise exception 'Pelo menos um motorista já está atribuído a outra viatura' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.vehicle_assignments va
    where va.vehicle_id = p_vehicle_id
      and va.driver_id = any(v_driver_ids)
      and va.active_from > current_date
      and (va.active_until is null or va.active_until >= current_date)
  ) then
    raise exception 'Um motorista selecionado já tem uma atribuição futura nesta viatura' using errcode = '23505';
  end if;

  -- Date-only history cannot represent an assignment that starts and ends
  -- on the same day without creating an inverted interval. Refuse that edit
  -- rather than corrupting the historical record; it can be changed tomorrow.
  if exists (
    select 1
    from public.vehicle_assignments va
    where va.vehicle_id = p_vehicle_id
      and va.active_from > current_date
      and (va.active_until is null or va.active_until >= current_date)
  ) then
    raise exception 'A viatura tem uma associação futura. Ajuste-a antes do arquivo.'
      using errcode = '22023';
  end if;

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
  'Atomically replaces active vehicle assignments, preserving completed history and checking company-admin authorization explicitly with a pinned search path.';


-- Deactivate a driver without deleting their identity or assignment history.
-- Uses the same lock order as s2t_replace_vehicle_assignments: vehicles first,
-- then driver. The replace RPC also rejects inactive drivers after acquiring
-- the driver row lock, preventing a concurrent new assignment after deactivation.
create or replace function public.s2t_deactivate_driver(p_driver_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_driver_status text;
  v_closed_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada' using errcode = '42501';
  end if;

  -- Acquire the assignment-table mutex before driver/vehicle locks to keep one lock order.
  lock table public.vehicle_assignments in share row exclusive mode;

  -- Serialize with assignment creation before discovering the driver's vehicles.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('s2t-driver:' || p_driver_id::text, 0)
  );

  -- Reject unauthorized callers before locking any fleet rows.
  select d.company_id, d.status
    into v_company_id, v_driver_status
  from public.drivers d
  where d.id = p_driver_id;
  if v_company_id is null then
    raise exception 'Motorista não encontrado ou sem empresa associada' using errcode = 'P0002';
  end if;
  if not public.s2t_is_admin()
     and not public.s2t_is_company_admin(v_company_id) then
    raise exception 'Motorista não encontrado ou sem empresa associada' using errcode = 'P0002';
  end if;

  -- Lock vehicles in stable order, then lock and recheck the driver.
  perform v.id
  from public.vehicles v
  join public.vehicle_assignments va on va.vehicle_id = v.id
  where va.driver_id = p_driver_id
    and va.active_from <= current_date
    and (va.active_until is null or va.active_until >= current_date)
  order by v.id
  for update of v;

  select d.company_id, d.status
    into v_company_id, v_driver_status
  from public.drivers d
  where d.id = p_driver_id
  for update;

  if v_company_id is null then
    raise exception 'Motorista não encontrado ou sem empresa associada' using errcode = 'P0002';
  end if;
  if not public.s2t_is_admin()
     and not public.s2t_is_company_admin(v_company_id) then
    raise exception 'Motorista não encontrado ou sem empresa associada' using errcode = 'P0002';
  end if;
  if coalesce(v_driver_status, 'Ativo') <> 'Ativo' then
    raise exception 'O motorista já está inativo' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.vehicle_assignments va
    where va.driver_id = p_driver_id
      and va.active_from > current_date
      and (va.active_until is null or va.active_until >= current_date)
  ) then
    raise exception 'O motorista tem uma associação futura. Ajuste-a antes da desativação.'
      using errcode = '22023';
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


-- Archive a vehicle and close its active assignments atomically.
create or replace function public.s2t_archive_vehicle(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_vehicle_status text;
  v_closed_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada' using errcode = '42501';
  end if;

  -- Acquire the assignment-table mutex before driver/vehicle locks to keep one lock order.
  lock table public.vehicle_assignments in share row exclusive mode;

  -- Verify company access before taking a row lock, then reread under lock.
  select v.company_id, v.status
    into v_company_id, v_vehicle_status
  from public.vehicles v
  where v.id = p_vehicle_id;

  if v_company_id is null then
    raise exception 'Viatura não encontrada ou sem empresa associada' using errcode = 'P0002';
  end if;
  if not public.s2t_is_admin()
     and not public.s2t_is_company_admin(v_company_id) then
    raise exception 'Viatura não encontrada ou sem empresa associada' using errcode = 'P0002';
  end if;

  select v.company_id, v.status
    into v_company_id, v_vehicle_status
  from public.vehicles v
  where v.id = p_vehicle_id
  for update;

  if v_company_id is null then
    raise exception 'Viatura não encontrada ou sem empresa associada' using errcode = 'P0002';
  end if;
  if not public.s2t_is_admin()
     and not public.s2t_is_company_admin(v_company_id) then
    raise exception 'Viatura não encontrada ou sem empresa associada' using errcode = 'P0002';
  end if;
  if coalesce(v_vehicle_status, 'Ativo') = 'Inativo' then
    raise exception 'A viatura já está inativa ou arquivada' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.vehicle_assignments va
    where va.vehicle_id = p_vehicle_id
      and va.active_from = current_date
      and (va.active_until is null or va.active_until >= current_date)
  ) then
    raise exception 'A viatura tem uma associação iniciada hoje. Para preservar o histórico, o arquivo só poderá ser concluído amanhã.'
      using errcode = '22023';
  end if;

  update public.vehicle_assignments va
     set active_until = current_date - 1
   where va.vehicle_id = p_vehicle_id
     and va.active_from < current_date
     and (va.active_until is null or va.active_until >= current_date);

  get diagnostics v_closed_count = row_count;

  update public.vehicles
     set status = 'Inativo'
   where id = p_vehicle_id
     and company_id = v_company_id;

  return jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'closed_assignments', v_closed_count,
    'status', 'Inativo'
  );
end;
$function$;

revoke all on function public.s2t_archive_vehicle(uuid) from public, anon;
grant execute on function public.s2t_archive_vehicle(uuid) to authenticated;

comment on function public.s2t_archive_vehicle(uuid) is
  'Atomically archives a vehicle and closes active assignments without deleting history. Refuses same-day interval closure.';

