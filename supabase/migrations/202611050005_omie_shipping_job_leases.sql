alter table public.omie_shipping_jobs
  add column if not exists worker_id text,
  add column if not exists claimed_at timestamptz,
  add column if not exists heartbeat_at timestamptz;

create index if not exists omie_shipping_jobs_claim_idx
  on public.omie_shipping_jobs (status, created_at)
  where status in ('queued', 'running');

create or replace function public.claim_omie_shipping_job(p_worker_id text)
returns setof public.omie_shipping_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9._:-]{1,128}$' then
    raise exception using message = 'INVALID_OMIE_WORKER_ID', errcode = '22023';
  end if;

  return query
  with candidate as (
    select job.id
    from public.omie_shipping_jobs as job
    where job.status = 'queued'
       or (
         job.status = 'running'
         and coalesce(job.heartbeat_at, job.updated_at) < now() - interval '10 minutes'
       )
    order by job.created_at asc
    for update skip locked
    limit 1
  )
  update public.omie_shipping_jobs as job
  set status = 'running',
      worker_id = p_worker_id,
      claimed_at = now(),
      heartbeat_at = now(),
      challenge_id = null,
      challenge_expires_at = null,
      mfa_attempts = 0,
      last_error = null,
      updated_at = now()
  from candidate
  where job.id = candidate.id
  returning job.*;
end;
$$;

revoke all on function public.claim_omie_shipping_job(text) from public, anon, authenticated;
grant execute on function public.claim_omie_shipping_job(text) to service_role;

create or replace function public.heartbeat_omie_shipping_job(p_job_id uuid, p_worker_id text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.omie_shipping_jobs
    set heartbeat_at = now(), updated_at = now()
    where id = p_job_id
      and worker_id = p_worker_id
      and status in ('running', 'awaiting_mfa', 'mfa_submitted')
    returning 1
  )
  select exists(select 1 from updated);
$$;

revoke all on function public.heartbeat_omie_shipping_job(uuid, text) from public, anon, authenticated;
grant execute on function public.heartbeat_omie_shipping_job(uuid, text) to service_role;

create or replace function public.set_omie_shipping_mfa_challenge(
  p_job_id uuid,
  p_worker_id text,
  p_challenge_id uuid,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_challenge_id is null or p_expires_at <= now() or p_expires_at > now() + interval '5 minutes' then
    raise exception using message = 'INVALID_OMIE_MFA_CHALLENGE', errcode = '22023';
  end if;

  update public.omie_shipping_jobs
  set status = 'awaiting_mfa',
      challenge_id = p_challenge_id,
      challenge_expires_at = p_expires_at,
      mfa_attempts = 0,
      heartbeat_at = now(),
      updated_at = now()
  where id = p_job_id
    and worker_id = p_worker_id
    and status = 'running';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.set_omie_shipping_mfa_challenge(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.set_omie_shipping_mfa_challenge(uuid, text, uuid, timestamptz) to service_role;

create or replace function public.complete_omie_shipping_job(p_job_id uuid, p_worker_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.omie_shipping_jobs
  set status = 'shipping_configured',
      completed_at = now(),
      heartbeat_at = now(),
      challenge_id = null,
      challenge_expires_at = null,
      updated_at = now()
  where id = p_job_id
    and worker_id = p_worker_id
    and status in ('running', 'mfa_submitted');

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.complete_omie_shipping_job(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_omie_shipping_job(uuid, text) to service_role;

create or replace function public.fail_omie_shipping_job(p_job_id uuid, p_worker_id text, p_error text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.omie_shipping_jobs
  set status = 'failed',
      last_error = left(coalesce(p_error, 'Worker failed without a reason.'), 500),
      completed_at = now(),
      heartbeat_at = now(),
      challenge_id = null,
      challenge_expires_at = null,
      updated_at = now()
  where id = p_job_id
    and worker_id = p_worker_id
    and status in ('running', 'awaiting_mfa', 'mfa_submitted');

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.fail_omie_shipping_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.fail_omie_shipping_job(uuid, text, text) to service_role;