create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.can_access_omie_mfa_topic()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.omie_shipping_jobs as job
    where job.requested_by = (select auth.uid())
      and job.status in ('awaiting_mfa', 'mfa_submitted')
      and job.challenge_id is not null
      and ('omie:mfa:' || job.challenge_id::text) = (select realtime.topic())
  );
$$;

revoke all on function private.can_access_omie_mfa_topic() from public, anon;
grant execute on function private.can_access_omie_mfa_topic() to authenticated;

drop policy if exists omie_mfa_private_broadcast_read on realtime.messages;
create policy omie_mfa_private_broadcast_read
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and private.can_access_omie_mfa_topic()
);

drop policy if exists omie_mfa_private_broadcast_write on realtime.messages;
create policy omie_mfa_private_broadcast_write
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and private.can_access_omie_mfa_topic()
);

drop function if exists public.can_access_omie_mfa_topic();