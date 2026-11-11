alter table public.shipments
  add column if not exists label_generation_state text not null default 'none'
    check (label_generation_state in ('none','processing','unknown','sources_ready','ready')),
  add column if not exists label_source_urls jsonb,
  add column if not exists label_invoice_key text,
  add column if not exists label_requested_at timestamptz;

-- Files are served only through the authenticated application route, never public URLs.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('shipping-labels', 'shipping-labels', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;
