create index if not exists idx_fulfillments_recipient_id
  on public.fulfillments(recipient_id);

create index if not exists idx_fulfillments_delivery_address_id
  on public.fulfillments(delivery_address_id);
