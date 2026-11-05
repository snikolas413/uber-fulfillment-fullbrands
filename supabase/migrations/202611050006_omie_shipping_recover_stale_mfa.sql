drop index if exists public.omie_shipping_jobs_claim_idx;
create index omie_shipping_jobs_claim_idx
  on public.omie_shipping_jobs (status, created_at)
  where status in ('queued', 'running', 'awaiting_mfa', 'mfa_submitted');

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
         job.status in ('running', 'awaiting_mfa', 'mfa_submitted')
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