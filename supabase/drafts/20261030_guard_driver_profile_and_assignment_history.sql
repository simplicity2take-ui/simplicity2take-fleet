-- REVIEW-ONLY PATCH for PR #32. NOT a migration.
-- Copy into a properly generated migration only after disposable-DB validation.
-- Protects driver account linkage and prevents API-role deletion of assignment history.
create or replace function public.s2t_guard_company_ownership_change()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if new.company_id is distinct from old.company_id
     and not public.s2t_is_admin() then
    raise exception 'Alteração da empresa proprietária reservada ao administrador global'
      using errcode = '42501';
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

-- Assignment rows are operational history. API roles must not delete them,
-- including global admins. Correct rows by closing active_until and inserting
-- a replacement; exceptional retention belongs in a separately audited process.
drop policy if exists "s2t assignments company admin delete"
  on public.vehicle_assignments;
revoke delete on table public.vehicle_assignments from anon, authenticated;

comment on function public.s2t_guard_company_ownership_change() is
  'Trigger-only guard: only global admins may change company ownership or drivers.profile_id.';
comment on table public.vehicle_assignments is
  'Assignment history: API roles cannot delete rows; corrections preserve history by closing intervals or inserting new rows.';
