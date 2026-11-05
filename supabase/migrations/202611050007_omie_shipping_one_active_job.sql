-- Prevent concurrent active shipping jobs for the same fulfillment.
-- Historical completed/failed jobs remain available for audit and retries.
create unique index if not exists omie_shipping_jobs_one_active_per_fulfillment_idx
  on public.omie_shipping_jobs (fulfillment_id)
  where status in ('queued', 'running', 'awaiting_mfa', 'mfa_submitted');
