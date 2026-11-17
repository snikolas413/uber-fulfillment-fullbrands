-- Server-only, shared across tabs, processes and deploys. Contains no credentials or order data.
create table public.omie_api_control (
  singleton boolean primary key default true check (singleton),
  paused_until timestamptz not null default '-infinity',
  lease_id uuid,
  lease_until timestamptz not null default '-infinity',
  next_call_at timestamptz not null default '-infinity'
);
alter table public.omie_api_control enable row level security;
-- No user policies: only service_role (BYPASSRLS) may access the control row.
revoke all on public.omie_api_control from public, anon, authenticated;
grant select, update on public.omie_api_control to service_role;
insert into public.omie_api_control(singleton) values (true);

create function public.acquire_omie_request(p_lease uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  control public.omie_api_control%rowtype;
  current_time_at timestamptz := clock_timestamp();
  delay_ms integer;
begin
  if p_lease is null then raise exception 'INVALID_LEASE'; end if;
  select * into strict control from public.omie_api_control where singleton for update;
  if control.paused_until > current_time_at then
    return jsonb_build_object('granted',false,'retry_at',control.paused_until);
  end if;
  if control.lease_until > current_time_at then
    return jsonb_build_object('granted',false,'retry_at',control.lease_until);
  end if;
  delay_ms := greatest(0,ceil(extract(epoch from (control.next_call_at - current_time_at))*1000))::integer;
  update public.omie_api_control set lease_id=p_lease,
    lease_until=current_time_at + interval '120 seconds' where singleton;
  return jsonb_build_object('granted',true,'wait_ms',delay_ms);
end;
$$;

create function public.finish_omie_request(p_lease uuid, p_pause_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  if p_pause_seconds is null or p_pause_seconds < 0 or p_pause_seconds > 86400 then
    raise exception 'INVALID_PAUSE';
  end if;
  update public.omie_api_control set
    paused_until=greatest(paused_until,clock_timestamp()+make_interval(secs=>p_pause_seconds)),
    lease_id=null, lease_until='-infinity', next_call_at=clock_timestamp()+interval '300 milliseconds'
    where singleton and lease_id=p_lease;
  get diagnostics changed = row_count;
  return changed=1;
end;
$$;

revoke all on function public.acquire_omie_request(uuid) from public, anon, authenticated;
revoke all on function public.finish_omie_request(uuid,integer) from public, anon, authenticated;
grant execute on function public.acquire_omie_request(uuid) to service_role;
grant execute on function public.finish_omie_request(uuid,integer) to service_role;
