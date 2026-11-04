-- Private storage for the Omie rotating access/refresh token pair.
-- Callable only with the Supabase service_role key from server code.

create or replace function public.get_omie_credentials()
returns text
language sql
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
    from vault.decrypted_secrets as ds
   where ds.name = 'uber_fulfillment_omie_credentials'
   limit 1;
$$;

revoke all on function public.get_omie_credentials() from public, anon, authenticated;
grant execute on function public.get_omie_credentials() to service_role;

create or replace function public.set_omie_credentials(p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_payload jsonb;
begin
  if p_secret is null or length(p_secret) > 12000 then
    raise exception using message = 'INVALID_OMIE_CREDENTIAL_PAYLOAD', errcode = '22023';
  end if;

  begin
    v_payload := p_secret::jsonb;
  exception when others then
    raise exception using message = 'INVALID_OMIE_CREDENTIAL_JSON', errcode = '22023';
  end;

  if jsonb_typeof(v_payload) <> 'object'
     or not (v_payload ?& array['appHash','accessToken','refreshToken','expiresAt']) then
    raise exception using message = 'INCOMPLETE_OMIE_CREDENTIAL_PAYLOAD', errcode = '22023';
  end if;

  select s.id
    into v_secret_id
    from vault.secrets as s
   where s.name = 'uber_fulfillment_omie_credentials'
   limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      p_secret,
      'uber_fulfillment_omie_credentials',
      'Rotating Omie API credentials for Uber Fulfillment',
      null
    );
  else
    perform vault.update_secret(
      v_secret_id,
      p_secret,
      'uber_fulfillment_omie_credentials',
      'Rotating Omie API credentials for Uber Fulfillment',
      null
    );
  end if;
end;
$$;

revoke all on function public.set_omie_credentials(text) from public, anon, authenticated;
grant execute on function public.set_omie_credentials(text) to service_role;

-- Synchronization metadata stays local; Omie remains the system of record for ERP/shipping events.
alter table public.fulfillments
  add column if not exists omie_submitted_at timestamptz,
  add column if not exists omie_last_sync_at timestamptz,
  add column if not exists omie_last_error text;

alter table public.shipments
  add column if not exists tracking_url text,
  add column if not exists estimated_delivery_date date,
  add column if not exists package_count integer,
  add column if not exists service_modality text,
  add column if not exists omie_last_sync_at timestamptz;
