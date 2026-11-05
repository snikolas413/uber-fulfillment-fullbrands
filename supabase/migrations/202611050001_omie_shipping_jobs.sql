create table if not exists public.omie_shipping_jobs (
  id uuid primary key default gen_random_uuid(),
  fulfillment_id uuid not null references public.fulfillments(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  status text not null default 'queued'
    check (status in ('queued','running','awaiting_mfa','mfa_submitted','shipping_configured','failed','expired','cancelled')),
  challenge_id uuid,
  challenge_expires_at timestamptz,
  mfa_attempts integer not null default 0 check (mfa_attempts between 0 and 5),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists omie_shipping_jobs_fulfillment_created_idx
  on public.omie_shipping_jobs (fulfillment_id, created_at desc);
create index if not exists omie_shipping_jobs_mfa_wait_idx
  on public.omie_shipping_jobs (requested_by, challenge_expires_at)
  where status = 'awaiting_mfa';

alter table public.omie_shipping_jobs enable row level security;

comment on table public.omie_shipping_jobs is
  'Durable metadata for Omie browser shipping jobs. MFA codes and browser credentials must never be stored in this table.';
comment on column public.omie_shipping_jobs.challenge_id is
  'Random challenge correlation ID only. The MFA code is handed off through short-lived private Render Key Value and is never persisted in Postgres.';
