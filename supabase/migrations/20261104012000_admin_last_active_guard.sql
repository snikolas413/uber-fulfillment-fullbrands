-- Prevent concurrent changes from removing the last active administrator.
create or replace function private.prevent_last_active_admin_demotion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'admin'
     and old.is_active = true
     and (new.role <> 'admin' or new.is_active = false) then
    perform pg_catalog.pg_advisory_xact_lock(73190, 201);
    if not exists (
      select 1 from public.user_profiles p
      where p.id <> old.id and p.role = 'admin' and p.is_active = true
    ) then
      raise exception 'O sistema precisa manter pelo menos um administrador ativo.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_last_active_admin_demotion()
  from public, anon, authenticated, service_role;

drop trigger if exists prevent_last_active_admin_demotion on public.user_profiles;
create trigger prevent_last_active_admin_demotion
before update of role, is_active on public.user_profiles
for each row execute function private.prevent_last_active_admin_demotion();
