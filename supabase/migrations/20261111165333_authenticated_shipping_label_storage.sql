-- Use the operator's authenticated session instead of a service-role credential.
-- The bucket remains private, with access bound to an existing shipment and its NF-e.
create or replace function private.can_access_shipping_label(object_name text, allowed_roles text[])
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.user_has_role(allowed_roles)
    and cardinality(storage.foldername(object_name)) = 2
    and storage.filename(object_name) ~ '^(original-[0-9]{1,2}|etiqueta-nfe-v1)[.]pdf$'
    and exists (
      select 1 from public.shipments s
      join public.fulfillments f on f.id = s.fulfillment_id
      where f.id::text = (storage.foldername(object_name))[1]
        and s.label_invoice_key = (storage.foldername(object_name))[2]
        and f.status <> 'cancelled'
    );
$$;
revoke all on function private.can_access_shipping_label(text, text[]) from public, anon;
grant execute on function private.can_access_shipping_label(text, text[]) to authenticated;

create policy shipping_labels_read on storage.objects for select to authenticated
using (bucket_id = 'shipping-labels' and private.can_access_shipping_label(name, array['admin','gestor','operador','consulta']));

create policy shipping_labels_insert on storage.objects for insert to authenticated
with check (bucket_id = 'shipping-labels' and private.can_access_shipping_label(name, array['admin','gestor','operador']));

create policy shipping_labels_update on storage.objects for update to authenticated
using (bucket_id = 'shipping-labels' and private.can_access_shipping_label(name, array['admin','gestor','operador']))
with check (bucket_id = 'shipping-labels' and private.can_access_shipping_label(name, array['admin','gestor','operador']));
