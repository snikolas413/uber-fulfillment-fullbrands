create or replace function public.can_access_omie_mfa_topic()
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