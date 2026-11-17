alter table public.fulfillments
  add column delivery_recipient_name text,
  add column omie_send_started_at timestamptz;

-- Names corrected for a specific delivery must not rename other orders.
create or replace function public.save_reviewed_fulfillment(
  p_id uuid, p_expected_updated_at timestamptz, p_fields jsonb
)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  f public.fulfillments%rowtype;
  a public.delivery_addresses%rowtype;
  v_address_id uuid;
  v_name text := btrim(p_fields->>'name');
  v_email text := lower(btrim(p_fields->>'email'));
  v_cep text := btrim(p_fields->>'postal_code');
  v_street text := btrim(p_fields->>'street');
  v_number text := btrim(p_fields->>'number');
  v_complement text := nullif(btrim(p_fields->>'complement'), '');
  v_district text := btrim(p_fields->>'district');
  v_city text := btrim(p_fields->>'city');
  v_state text := upper(btrim(p_fields->>'state'));
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.user_has_role(array['admin','gestor','operador']) then raise exception 'FORBIDDEN'; end if;
  if coalesce(length(v_name),0) not between 3 and 60
    or coalesce(length(v_email),0) not between 3 and 160
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or coalesce(v_cep,'') !~ '^[0-9]{8}$'
    or coalesce(length(v_street),0) not between 1 and 60
    or coalesce(length(v_number),0) not between 1 and 10
    or coalesce(length(v_complement),0) > 60
    or coalesce(length(v_district),0) not between 1 and 60
    or coalesce(length(v_city),0) not between 1 and 40
    or v_city ~ '[/()]' or v_city ~* '[[:space:]](AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$'
    or coalesce(v_state,'') <> all(array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'])
  then raise exception 'INVALID_REVIEW_FIELDS'; end if;
  select * into f from public.fulfillments where id=p_id for update;
  if not found or f.omie_order_id is not null or f.status not in ('order_pending','error') then
    raise exception 'NOT_REVIEWABLE';
  end if;
  if f.omie_send_started_at > now() - interval '15 minutes' then raise exception 'SEND_IN_PROGRESS'; end if;
  if f.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_CHANGED'; end if;
  select * into strict a from public.delivery_addresses where id=f.delivery_address_id;
  insert into public.delivery_addresses(recipient_id,postal_code,street,number,complement,district,city,state,country,validation_status)
  values(f.recipient_id,v_cep,v_street,v_number,v_complement,v_district,v_city,v_state,a.country,'pending')
  returning id into v_address_id;
  update public.fulfillments set delivery_address_id=v_address_id, delivery_recipient_name=v_name,
    customer_email=v_email, updated_at=clock_timestamp()
  where id=p_id;
  insert into public.audit_logs(actor_id,entity_type,entity_id,action,before_summary,after_summary,source)
  values(auth.uid(),'fulfillment',p_id,'fulfillment.review_corrected',
    jsonb_build_object('delivery_address_id',a.id,'delivery_recipient_name',f.delivery_recipient_name,'customer_email',f.customer_email,'status',f.status,'omie_last_error',f.omie_last_error),
    jsonb_build_object('delivery_address_id',v_address_id,'delivery_recipient_name',v_name,'customer_email',v_email,'status',f.status,'sent_to_omie',false),
    'application');
end;
$$;
revoke all on function public.save_reviewed_fulfillment(uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.save_reviewed_fulfillment(uuid,timestamptz,jsonb) to authenticated;
