-- Preserve accent-insensitive directory searches without changing RLS or grants.
create or replace view public.operation_orders with (security_invoker = true) as
select f.id,f.status,f.created_at,f.updated_at,f.omie_order_id,f.omie_order_number,
 f.omie_last_error,f.omie_last_sync_at,f.separation_state,f.delivery_recipient_name,
 f.customer_purchase_order,f.customer_email,
 jsonb_build_object('full_name',r.full_name,'email',r.email) as recipients,
 jsonb_build_object('city',a.city,'state',a.state,'postal_code',a.postal_code) as delivery_addresses,
 (select coalesce(jsonb_agg(jsonb_build_object('product_code',it.product_code,'description',it.description,'quantity',it.quantity,'unit_price',it.unit_price,'line_total',it.line_total) order by it.id),'[]'::jsonb) from public.fulfillment_items it where it.fulfillment_id=f.id) as fulfillment_items,
 case when i.id is not null then jsonb_build_object('omie_invoice_number',i.omie_invoice_number,'access_key',i.access_key,'status',i.status,'issued_at',i.issued_at,'danfe_url',i.danfe_url,'xml_available',i.xml_available,'confirmation_state',i.confirmation_state,'confirmation_last_error',i.confirmation_last_error) end as invoices,
 case when s.id is not null then jsonb_build_object('carrier_id',s.carrier_id,'service_code',s.service_code,'tracking_code',s.tracking_code,'tracking_url',s.tracking_url,'estimated_delivery_date',s.estimated_delivery_date,'package_count',s.package_count,'service_modality',s.service_modality,'status',s.status,'label_storage_path',s.label_storage_path,'label_generation_state',s.label_generation_state,'label_last_error',s.label_last_error,'label_error_at',s.label_error_at,'freight_amount',s.freight_amount) end as shipments,
 concat_ws(' ',concat_ws(' ',coalesce(f.delivery_recipient_name,r.full_name),f.omie_order_number,regexp_replace(f.omie_order_number,'^0+',''),f.customer_purchase_order,f.customer_email,i.omie_invoice_number,regexp_replace(i.omie_invoice_number,'^0+',''),s.tracking_code,a.city),translate(lower(concat_ws(' ',coalesce(f.delivery_recipient_name,r.full_name),f.omie_order_number,regexp_replace(f.omie_order_number,'^0+',''),f.customer_purchase_order,f.customer_email,i.omie_invoice_number,regexp_replace(i.omie_invoice_number,'^0+',''),s.tracking_code,a.city)),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')) as search_text,
 coalesce(f.status<>'cancelled' and i.status='006' and i.access_key ~ '^[0-9]{44}$' and nullif(i.omie_invoice_number,'') is not null,false) as invoice_authorized,
 coalesce(f.status<>'cancelled' and i.status='006' and s.label_generation_state='ready' and s.label_storage_path=f.id::text||'/'||i.access_key||'/etiqueta-nfe-v1.pdf' and s.label_invoice_key=i.access_key,false) as label_printable,
 case when f.status='cancelled' then null
   when i.status='006' and i.access_key ~ '^[0-9]{44}$' and nullif(i.omie_invoice_number,'') is not null then 'billed'
   when f.status in ('order_created','billing_pending') and (i.confirmation_state in ('pending','checking') or i.status in ('billing_processing','billing_submitting','billing_submitted','billing_unknown')) then 'confirming'
   when f.status in ('order_created','billing_pending') and (i.id is not null or i.confirmation_state='error' or (f.separation_state='confirmed' and (nullif(f.omie_last_error,'') is not null or s.carrier_id is null or s.freight_amount is distinct from 0 or (coalesce(s.service_code,'')<>'04227' and lower(coalesce(s.service_code,'')) !~ 'mini.*envio')))) then 'attention'
   when f.status in ('order_created','billing_pending') and f.separation_state='confirmed' then 'ready'
   else null end as billing_queue,
 case when f.status in ('order_created','billing_pending') and f.separation_state<>'confirmed' and (i.id is null or (i.status='billing_rejected' and i.access_key is null and i.omie_invoice_number is null))
   then case when f.separation_state in ('unknown','processing') or nullif(f.omie_last_error,'') is not null then 'attention' else 'awaiting' end
   when f.status in ('order_created','billing_pending') and f.separation_state='confirmed' then 'confirmed' else null end as separation_queue,
 case when f.status='cancelled' then null
   when f.status='shipped' then 'shipped'
   when i.status='006' and s.label_generation_state='ready' and s.label_storage_path=f.id::text||'/'||i.access_key||'/etiqueta-nfe-v1.pdf' and s.label_invoice_key=i.access_key then 'ready'
   when f.status in ('billed','shipping_pending','label_ready') or (f.status='billing_pending' and i.access_key is not null)
     then case when i.status is distinct from '006' or s.label_generation_state in ('unknown','processing') or nullif(s.label_last_error,'') is not null then 'attention' else 'pending' end
   else null end as shipping_queue
from public.fulfillments f
join public.recipients r on r.id=f.recipient_id
join public.delivery_addresses a on a.id=f.delivery_address_id
left join public.invoices i on i.fulfillment_id=f.id
left join public.shipments s on s.fulfillment_id=f.id;

create or replace view public.recipient_directory with (security_invoker = true) as
select r.id,r.full_name,r.document_number,r.email,r.phone,r.created_at,r.updated_at,
 coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id desc) from public.delivery_addresses a where a.recipient_id=r.id),'[]'::jsonb) as delivery_addresses,
 (select a.city from public.delivery_addresses a where a.recipient_id=r.id order by a.created_at desc,a.id desc limit 1) as city,
 (select a.validation_status from public.delivery_addresses a where a.recipient_id=r.id order by a.created_at desc,a.id desc limit 1) as address_status,
 concat_ws(' ',concat_ws(' ',r.full_name,r.document_number,regexp_replace(r.document_number,'\D','','g'),r.email,r.phone,regexp_replace(r.phone,'\D','','g'),(select a.city from public.delivery_addresses a where a.recipient_id=r.id order by a.created_at desc,a.id desc limit 1)),translate(lower(concat_ws(' ',r.full_name,r.document_number,regexp_replace(r.document_number,'\D','','g'),r.email,r.phone,regexp_replace(r.phone,'\D','','g'),(select a.city from public.delivery_addresses a where a.recipient_id=r.id order by a.created_at desc,a.id desc limit 1))),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')) as search_text
from public.recipients r;
