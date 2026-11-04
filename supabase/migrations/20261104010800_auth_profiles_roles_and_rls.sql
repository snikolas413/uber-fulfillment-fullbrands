-- Authentication profiles, role model, invitation-only activation, and RLS.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  email text,
  full_name text not null default 'Usuário',
  role text not null default 'operador'
    check (role in ('admin', 'gestor', 'operador', 'consulta')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_profiles_role_active on public.user_profiles(role, is_active);

create or replace function private.user_has_role(allowed_roles text[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_profiles p
    where p.id = (select auth.uid())
      and p.is_active = true
      and p.role = any(allowed_roles)
  );
$$;
revoke all on function private.user_has_role(text[]) from public, anon;
grant execute on function private.user_has_role(text[]) to authenticated;

create or replace function private.handle_auth_user_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare profile_name text;
begin
  profile_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Usuário'
  );
  insert into public.user_profiles (id, email, full_name, role, is_active)
  values (new.id, new.email, profile_name, 'operador', false)
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;
revoke all on function private.handle_auth_user_profile() from public, anon, authenticated;
drop trigger if exists on_auth_user_profile_created on auth.users;
create trigger on_auth_user_profile_created after insert or update of email on auth.users
for each row execute function private.handle_auth_user_profile();

alter table public.user_profiles enable row level security;
create policy "profiles_select_self_or_management" on public.user_profiles
for select to authenticated
using (id = (select auth.uid()) or (select private.user_has_role(array['admin','gestor'])));
create policy "profiles_update_admin_only" on public.user_profiles
for update to authenticated
using ((select private.user_has_role(array['admin'])))
with check ((select private.user_has_role(array['admin'])));

grant usage on schema public to authenticated;
revoke all on table public.user_profiles from anon;
grant select, update on table public.user_profiles to authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated, service_role;

revoke all on table public.recipients, public.delivery_addresses, public.fulfillments,
public.invoices, public.shipments, public.integration_events, public.audit_logs from anon;

grant select, insert, update, delete on table public.recipients, public.delivery_addresses,
public.fulfillments, public.invoices, public.shipments to authenticated;
grant select, insert on table public.integration_events, public.audit_logs to authenticated;

create policy "recipients_read_internal" on public.recipients for select to authenticated using ((select private.user_has_role(array['admin','gestor','operador','consulta'])));
create policy "recipients_insert_operator_plus" on public.recipients for insert to authenticated with check ((select private.user_has_role(array['admin','gestor','operador'])));
create policy "recipients_update_operator_plus" on public.recipients for update to authenticated using ((select private.user_has_role(array['admin','gestor','operador']))) with check ((select private.user_has_role(array['admin','gestor','operador'])));
create policy "recipients_delete_admin" on public.recipients for delete to authenticated using ((select private.user_has_role(array['admin'])));

create policy "addresses_read_internal" on public.delivery_addresses for select to authenticated using ((select private.user_has_role(array['admin','gestor','operador','consulta'])));
create policy "addresses_insert_operator_plus" on public.delivery_addresses for insert to authenticated with check ((select private.user_has_role(array['admin','gestor','operador'])));
create policy "addresses_update_operator_plus" on public.delivery_addresses for update to authenticated using ((select private.user_has_role(array['admin','gestor','operador']))) with check ((select private.user_has_role(array['admin','gestor','operador'])));
create policy "addresses_delete_admin" on public.delivery_addresses for delete to authenticated using ((select private.user_has_role(array['admin'])));

create policy "fulfillments_read_internal" on public.fulfillments for select to authenticated using ((select private.user_has_role(array['admin','gestor','operador','consulta'])));
create policy "fulfillments_insert_operator_plus" on public.fulfillments for insert to authenticated with check ((select private.user_has_role(array['admin','gestor','operador'])) and (created_by is null or created_by = (select auth.uid())));
create policy "fulfillments_update_operator_plus" on public.fulfillments for update to authenticated using ((select private.user_has_role(array['admin','gestor','operador']))) with check ((select private.user_has_role(array['admin','gestor','operador'])) and (created_by is null or created_by = (select auth.uid())));
create policy "fulfillments_delete_admin" on public.fulfillments for delete to authenticated using ((select private.user_has_role(array['admin'])));

create policy "invoices_read_internal" on public.invoices for select to authenticated using ((select private.user_has_role(array['admin','gestor','operador','consulta'])));
create policy "invoices_insert_operator_plus" on public.invoices for insert to authenticated with check ((select private.user_has_role(array['admin','gestor','operador'])));
create policy "invoices_update_operator_plus" on public.invoices for update to authenticated using ((select private.user_has_role(array['admin','gestor','operador']))) with check ((select private.user_has_role(array['admin','gestor','operador'])));
create policy "invoices_delete_admin" on public.invoices for delete to authenticated using ((select private.user_has_role(array['admin'])));

create policy "shipments_read_internal" on public.shipments for select to authenticated using ((select private.user_has_role(array['admin','gestor','operador','consulta'])));
create policy "shipments_insert_operator_plus" on public.shipments for insert to authenticated with check ((select private.user_has_role(array['admin','gestor','operador'])));
create policy "shipments_update_operator_plus" on public.shipments for update to authenticated using ((select private.user_has_role(array['admin','gestor','operador']))) with check ((select private.user_has_role(array['admin','gestor','operador'])));
create policy "shipments_delete_admin" on public.shipments for delete to authenticated using ((select private.user_has_role(array['admin'])));

create policy "integration_events_read_management" on public.integration_events for select to authenticated using ((select private.user_has_role(array['admin','gestor'])));
create policy "integration_events_insert_operator_plus" on public.integration_events for insert to authenticated with check ((select private.user_has_role(array['admin','gestor','operador'])));

create policy "audit_logs_read_management" on public.audit_logs for select to authenticated using ((select private.user_has_role(array['admin','gestor'])));
create policy "audit_logs_insert_self" on public.audit_logs for insert to authenticated with check (actor_id = (select auth.uid()) and (select private.user_has_role(array['admin','gestor','operador'])));
