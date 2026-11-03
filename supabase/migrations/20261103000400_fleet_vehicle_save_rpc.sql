-- Save vehicle details and its assignment set in one authenticated transaction.
create or replace function public.s2t_save_vehicle_with_assignments(
  p_vehicle_id uuid,
  p_company_id uuid,
  p_plate text,
  p_brand text,
  p_model text,
  p_vehicle_year integer,
  p_vin text,
  p_status text,
  p_driver_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_vehicle_id uuid := p_vehicle_id;
  v_company_id uuid := p_company_id;
  v_existing_company_id uuid;
  v_existing_status text;
  v_driver_ids uuid[] := coalesce(p_driver_ids, '{}'::uuid[]);
  v_requested_driver_ids uuid[] := '{}'::uuid[];
  v_active_driver_ids uuid[] := '{}'::uuid[];
  v_requested_count integer := 0;
  v_assignment_result jsonb := '{}'::jsonb;
  v_created boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada' using errcode = '42501';
  end if;
  if v_company_id is null then
    raise exception 'Empresa não selecionada' using errcode = '22023';
  end if;
  if p_status not in ('Ativo', 'Manutenção', 'Inativo') then
    raise exception 'Estado da viatura inválido' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.companies c
    where c.id = v_company_id and c.status = 'Ativa'
  ) then
    raise exception 'Empresa não encontrada ou inativa' using errcode = 'P0002';
  end if;
  if not public.s2t_is_admin()
     and not public.s2t_is_company_admin(v_company_id) then
    raise exception 'Sem permissão para gerir viaturas desta empresa' using errcode = '42501';
  end if;

  -- Match assignment, archive, deactivation, and ownership-transfer lock order.
  lock table public.vehicle_assignments in share row exclusive mode;

  select count(*) into v_requested_count
  from unnest(v_driver_ids) as requested(driver_id);
  if v_requested_count <> (
    select count(distinct requested.driver_id)
    from unnest(v_driver_ids) as requested(driver_id)
  ) then
    raise exception 'A lista contém motoristas repetidos ou inválidos' using errcode = '22023';
  end if;
  select coalesce(array_agg(requested.driver_id order by requested.driver_id), '{}'::uuid[])
    into v_requested_driver_ids
  from unnest(v_driver_ids) as requested(driver_id);

  if v_vehicle_id is null then
    if p_status = 'Inativo' then
      raise exception 'Uma viatura nova tem de ser criada ativa ou em manutenção' using errcode = '22023';
    end if;
    if p_status <> 'Ativo' and v_requested_count > 0 then
      raise exception 'Só uma viatura ativa pode receber motoristas' using errcode = '23514';
    end if;

    insert into public.vehicles (
      id, company_id, plate, brand, model, vehicle_year, vin, status
    ) values (
      gen_random_uuid(), v_company_id, coalesce(btrim(p_plate), ''),
      coalesce(btrim(p_brand), ''), coalesce(btrim(p_model), ''),
      p_vehicle_year, nullif(btrim(p_vin), ''), p_status
    )
    returning id into v_vehicle_id;
    v_created := true;
  else
    select v.company_id, v.status
      into v_existing_company_id, v_existing_status
    from public.vehicles v
    where v.id = v_vehicle_id
    for update;

    if not found or v_existing_company_id is distinct from v_company_id then
      raise exception 'Viatura não encontrada nesta empresa' using errcode = 'P0002';
    end if;
    if not public.s2t_is_admin()
       and not public.s2t_is_company_admin(v_existing_company_id) then
      raise exception 'Viatura não encontrada nesta empresa' using errcode = 'P0002';
    end if;
    if p_status = 'Inativo' and v_existing_status is distinct from 'Inativo' then
      raise exception 'Use a ação Arquivar para preservar o histórico' using errcode = '23514';
    end if;

    select coalesce(array_agg(va.driver_id order by va.driver_id), '{}'::uuid[])
      into v_active_driver_ids
    from public.vehicle_assignments va
    where va.vehicle_id = v_vehicle_id
      and va.active_from <= current_date
      and (va.active_until is null or va.active_until >= current_date);

    if p_status <> 'Ativo'
       and v_requested_driver_ids is distinct from v_active_driver_ids then
      raise exception 'Mantenha as associações inalteradas enquanto a viatura não estiver ativa'
        using errcode = '23514';
    end if;
    if p_status = 'Inativo' and cardinality(v_active_driver_ids) > 0 then
      raise exception 'Arquive a viatura para encerrar as associações ativas'
        using errcode = '23514';
    end if;

    update public.vehicles
    set plate = coalesce(btrim(p_plate), ''),
        brand = coalesce(btrim(p_brand), ''),
        model = coalesce(btrim(p_model), ''),
        vehicle_year = p_vehicle_year,
        vin = nullif(btrim(p_vin), ''),
        status = p_status
    where id = v_vehicle_id and company_id = v_company_id;
  end if;

  if p_status = 'Ativo' then
    v_assignment_result := public.s2t_replace_vehicle_assignments(v_vehicle_id, v_driver_ids);
  end if;

  return jsonb_build_object(
    'vehicle_id', v_vehicle_id,
    'created', v_created,
    'assignment', v_assignment_result
  );
end;
$function$;

revoke all on function public.s2t_save_vehicle_with_assignments(uuid, uuid, text, text, text, integer, text, text, uuid[])
  from public, anon;
grant execute on function public.s2t_save_vehicle_with_assignments(uuid, uuid, text, text, text, integer, text, text, uuid[])
  to authenticated;

comment on function public.s2t_save_vehicle_with_assignments(uuid, uuid, text, text, text, integer, text, text, uuid[]) is
  'Atomically saves vehicle details and its assignment set for an active company administrator or global administrator.';
