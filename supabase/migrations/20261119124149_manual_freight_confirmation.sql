create function public.confirm_manual_freight(
  p_id uuid, p_expected_updated_at timestamptz, p_order_id bigint,
  p_confirmed boolean, p_freight jsonb
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  f public.fulfillments%rowtype;
  s public.shipments%rowtype;
begin
  if auth.uid() is null or not coalesce(private.user_has_role(array['admin','gestor','operador']),false) then
    raise exception 'FORBIDDEN';
  end if;
  if p_confirmed is distinct from true or p_freight is null
    or not (p_freight @> '{"carrier_id":"2757271756","service_code":"Mini Envios","freight_amount":0,"service_modality":"0"}'::jsonb)
    or coalesce((p_freight->>'package_count')::integer,0) not between 1 and 20
    or coalesce(p_freight->>'estimated_delivery_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  then raise exception 'INVALID_FREIGHT'; end if;
  select * into f from public.fulfillments where id=p_id for update;
  if not found or f.status not in ('order_created','billing_pending') or f.omie_order_id is distinct from p_order_id
    or p_order_id is null or f.updated_at is distinct from p_expected_updated_at
    or f.omie_send_started_at > now()-interval '15 minutes'
  then raise exception 'ORDER_CHANGED'; end if;
  -- The parent lock also serializes an initial invoice/label insert via its FK.
  perform 1 from public.invoices where fulfillment_id=p_id for update;
  if exists(select 1 from public.invoices where fulfillment_id=p_id and (
    status is distinct from 'billing_rejected' or omie_invoice_number is not null or access_key is not null
    or confirmation_state is distinct from 'none')) then raise exception 'INVOICE_REGISTERED'; end if;
  select * into s from public.shipments where fulfillment_id=p_id for update;
  if found and (s.label_generation_state is distinct from 'none' or s.label_storage_path is not null) then
    raise exception 'LABEL_REGISTERED';
  end if;
  insert into public.shipments(fulfillment_id,carrier_id,service_code,freight_amount,package_count,service_modality,
    estimated_delivery_date,status,omie_last_sync_at)
  values(p_id,'2757271756','Mini Envios',0,(p_freight->>'package_count')::integer,'0',
    (p_freight->>'estimated_delivery_date')::date,'shipping_pending',clock_timestamp())
  on conflict(fulfillment_id) do update set carrier_id=excluded.carrier_id,service_code=excluded.service_code,
    freight_amount=excluded.freight_amount,package_count=excluded.package_count,service_modality=excluded.service_modality,
    estimated_delivery_date=excluded.estimated_delivery_date,omie_last_sync_at=excluded.omie_last_sync_at,
    updated_at=clock_timestamp();
  update public.fulfillments set
    omie_last_error=case when omie_last_error like 'Frete: %' then null else omie_last_error end,
    updated_at=clock_timestamp()
  where id=p_id;
  insert into public.audit_logs(actor_id,entity_type,entity_id,action,source,before_summary,after_summary)
  values(auth.uid(),'fulfillment',p_id,'omie.freight.manual_adjustment_confirmed','application',
    jsonb_build_object('omie_last_error',f.omie_last_error,'status',f.status,'carrier_id',s.carrier_id,
      'service_code',s.service_code,'freight_amount',s.freight_amount),
    p_freight || jsonb_build_object('omie_order_id',p_order_id,'operator_confirmed_mini_envios',true,
      'omie_validation','0','omie_data_changed',false,'invoice_requested',false,'label_requested',false));
end;
$$;
revoke all on function public.confirm_manual_freight(uuid,timestamptz,bigint,boolean,jsonb) from public,anon;
grant execute on function public.confirm_manual_freight(uuid,timestamptz,bigint,boolean,jsonb) to authenticated;
