alter table public.fulfillments
  add column if not exists omie_customer_id bigint,
  add column if not exists omie_tax_scenario_id bigint,
  add column if not exists customer_purchase_order text;

create table if not exists public.fulfillment_items (
  id uuid primary key default gen_random_uuid(),
  fulfillment_id uuid not null references public.fulfillments(id) on delete restrict,
  omie_product_id bigint not null,
  product_code text not null,
  description text not null,
  ncm text,
  cfop text,
  unit text not null,
  quantity numeric(12,3) not null check (quantity > 0 and quantity <= 999),
  unit_price numeric(12,2) not null check (unit_price > 0),
  line_total numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  created_at timestamptz not null default now()
);

create index if not exists idx_fulfillment_items_fulfillment
  on public.fulfillment_items(fulfillment_id);

alter table public.fulfillment_items enable row level security;
revoke all on table public.fulfillment_items from anon;
grant select, insert on table public.fulfillment_items to authenticated;

create policy "fulfillment_items_read_internal"
on public.fulfillment_items
for select to authenticated
using ((select private.user_has_role(array['admin','gestor','operador','consulta'])));

create policy "fulfillment_items_insert_operator_plus"
on public.fulfillment_items
for insert to authenticated
with check (
  (select private.user_has_role(array['admin','gestor','operador']))
  and exists (
    select 1
      from public.fulfillments f
     where f.id = fulfillment_id
       and f.created_by = (select auth.uid())
  )
);

create or replace function public.prepare_uber_fulfillment(
  p_recipient_id uuid,
  p_delivery_address_id uuid,
  p_idempotency_key text,
  p_customer_purchase_order text,
  p_quantity numeric,
  p_unit_price numeric
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fulfillment_id uuid;
  v_address public.delivery_addresses%rowtype;
begin
  if auth.uid() is null then
    raise exception using message = 'AUTH_REQUIRED', errcode = '28000';
  end if;

  if not private.user_has_role(array['admin','gestor','operador']) then
    raise exception using message = 'FORBIDDEN', errcode = '42501';
  end if;

  if p_idempotency_key is null or length(p_idempotency_key) < 20 or length(p_idempotency_key) > 80 then
    raise exception using message = 'INVALID_IDEMPOTENCY_KEY', errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 999 then
    raise exception using message = 'INVALID_QUANTITY', errcode = '22023';
  end if;
  if p_unit_price is null or p_unit_price <= 0 or p_unit_price > 999999.99 then
    raise exception using message = 'INVALID_UNIT_PRICE', errcode = '22023';
  end if;
  if length(coalesce(btrim(p_customer_purchase_order), '')) > 30 then
    raise exception using message = 'INVALID_PURCHASE_ORDER', errcode = '22023';
  end if;

  select *
    into v_address
    from public.delivery_addresses
   where id = p_delivery_address_id
     and recipient_id = p_recipient_id;

  if not found then
    raise exception using message = 'ADDRESS_NOT_FOUND', errcode = 'P0002';
  end if;
  if v_address.validation_status = 'invalid' then
    raise exception using message = 'ADDRESS_INVALID', errcode = '22023';
  end if;

  insert into public.fulfillments (
    recipient_id,
    delivery_address_id,
    status,
    idempotency_key,
    created_by,
    omie_customer_id,
    omie_tax_scenario_id,
    customer_purchase_order
  ) values (
    p_recipient_id,
    p_delivery_address_id,
    'ready',
    p_idempotency_key,
    auth.uid(),
    2867720329,
    2954399884,
    nullif(btrim(p_customer_purchase_order), '')
  )
  returning id into v_fulfillment_id;

  insert into public.fulfillment_items (
    fulfillment_id,
    omie_product_id,
    product_code,
    description,
    ncm,
    cfop,
    unit,
    quantity,
    unit_price
  ) values (
    v_fulfillment_id,
    2948561716,
    'R18',
    'REMOTE BUTTON',
    '8517.62.99',
    '6.117',
    'PC',
    p_quantity,
    p_unit_price
  );

  insert into public.audit_logs (
    actor_id, entity_type, entity_id, action, after_summary, source
  ) values (
    auth.uid(),
    'fulfillment',
    v_fulfillment_id,
    'fulfillment.prepared',
    jsonb_build_object(
      'status', 'ready',
      'recipient_id', p_recipient_id,
      'delivery_address_id', p_delivery_address_id,
      'product_code', 'R18',
      'quantity', p_quantity,
      'unit_price', p_unit_price,
      'purchase_order', nullif(btrim(p_customer_purchase_order), ''),
      'external_omie_request', false
    ),
    'application'
  );

  return v_fulfillment_id;
end;
$$;

revoke all on function public.prepare_uber_fulfillment(uuid, uuid, text, text, numeric, numeric)
  from public, anon;
grant execute on function public.prepare_uber_fulfillment(uuid, uuid, text, text, numeric, numeric)
  to authenticated;
