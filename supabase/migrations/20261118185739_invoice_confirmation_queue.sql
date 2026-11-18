alter table public.invoices
  add column confirmation_state text not null default 'none'
    check (confirmation_state in ('none','pending','checking','confirmed','error')),
  add column confirmation_next_check_at timestamptz,
  add column confirmation_attempts integer not null default 0 check (confirmation_attempts >= 0),
  add column confirmation_last_error text check (length(confirmation_last_error) <= 1200),
  add column confirmation_lease uuid,
  add column confirmation_lease_until timestamptz,
  add column confirmation_claimed_by uuid;

create index invoices_confirmation_due on public.invoices(confirmation_next_check_at)
  where confirmation_state in ('pending','checking');

create function public.claim_invoice_confirmation(p_lease uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; job public.invoices%rowtype;
begin
  if p_lease is null or not private.user_has_role(array['admin','gestor','operador']) then
    raise exception 'FORBIDDEN';
  end if;
  select i.id into v_id from public.invoices i
    join public.fulfillments f on f.id=i.fulfillment_id
    where f.omie_order_id is not null and (
      (i.confirmation_state='pending' and i.confirmation_next_check_at <= clock_timestamp()) or
      (i.confirmation_state='checking' and i.confirmation_lease_until <= clock_timestamp())
    )
    order by i.confirmation_next_check_at,i.id
    for update of i skip locked limit 1;
  if v_id is null then return null; end if;
  update public.invoices set confirmation_state='checking',confirmation_lease=p_lease,
    confirmation_lease_until=clock_timestamp()+interval '120 seconds',confirmation_claimed_by=auth.uid()
    where id=v_id returning * into job;
  return jsonb_build_object('invoice_id',job.id,'fulfillment_id',job.fulfillment_id,'attempts',job.confirmation_attempts);
end;
$$;

create function public.finish_invoice_confirmation(
  p_invoice_id uuid,p_lease uuid,p_state text,p_next_check_at timestamptz,p_message text,p_attempted boolean
)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  if not private.user_has_role(array['admin','gestor','operador']) then raise exception 'FORBIDDEN'; end if;
  if p_state is null or p_state not in ('pending','confirmed','error') or p_attempted is null or length(p_message)>1200
    or (p_state='pending' and p_next_check_at is null) then raise exception 'INVALID_CONFIRMATION_STATE'; end if;
  update public.invoices set confirmation_state=p_state,
    confirmation_next_check_at=case when p_state='pending' then greatest(p_next_check_at,clock_timestamp()+interval '61 seconds') else null end,
    confirmation_attempts=confirmation_attempts+case when p_attempted then 1 else 0 end,
    confirmation_last_error=p_message,confirmation_lease=null,confirmation_lease_until=null,confirmation_claimed_by=null
    where id=p_invoice_id and confirmation_state='checking' and confirmation_lease=p_lease
      and confirmation_claimed_by=auth.uid() and confirmation_lease_until>clock_timestamp()
      and (p_state<>'confirmed' or (status='006' and omie_invoice_number is not null and access_key ~ '^[0-9]{44}$' and protocol is not null));
  get diagnostics changed = row_count;
  return changed=1;
end;
$$;

revoke all on function public.claim_invoice_confirmation(uuid) from public,anon,authenticated,service_role;
revoke all on function public.finish_invoice_confirmation(uuid,uuid,text,timestamptz,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.claim_invoice_confirmation(uuid) to authenticated;
grant execute on function public.finish_invoice_confirmation(uuid,uuid,text,timestamptz,text,boolean) to authenticated;

-- Previously accepted/uncertain submissions may be reconciled by reads, never reissued.
update public.invoices set confirmation_state='pending',confirmation_next_check_at=now()+interval '61 seconds'
  where status in ('billing_submitted','billing_unknown') and (omie_invoice_number is null or access_key is null);
