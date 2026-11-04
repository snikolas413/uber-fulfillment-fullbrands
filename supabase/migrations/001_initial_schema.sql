create extension if not exists pgcrypto;
create table if not exists public.recipients (
 id uuid primary key default gen_random_uuid(), full_name text not null, document_number text, email text, phone text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.delivery_addresses (
 id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.recipients(id) on delete restrict,
 postal_code text not null, street text not null, number text not null, complement text, district text not null,
 city text not null, state char(2) not null, country char(2) not null default 'BR',
 validation_status text not null default 'pending' check (validation_status in ('pending','valid','invalid','manual_review')),
 validated_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.fulfillments (
 id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.recipients(id) on delete restrict,
 delivery_address_id uuid not null references public.delivery_addresses(id) on delete restrict,
 status text not null default 'ready' check (status in ('ready','order_pending','order_created','billing_pending','billed','shipping_pending','label_ready','shipped','error','cancelled')),
 idempotency_key text not null unique, omie_order_id bigint unique, omie_order_number text, created_by uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.invoices (
 id uuid primary key default gen_random_uuid(), fulfillment_id uuid not null unique references public.fulfillments(id) on delete restrict,
 omie_invoice_number text, series text, access_key text unique, protocol text, status text not null default 'unknown',
 issued_at timestamptz, danfe_storage_path text, xml_storage_path text, created_at timestamptz not null default now()
);
create table if not exists public.shipments (
 id uuid primary key default gen_random_uuid(), fulfillment_id uuid not null unique references public.fulfillments(id) on delete restrict,
 carrier_id text, service_code text, package_code text, tracking_code text unique, label_storage_path text,
 status text not null default 'pending', freight_amount numeric(12,2), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.integration_events (
 id uuid primary key default gen_random_uuid(), fulfillment_id uuid references public.fulfillments(id) on delete restrict,
 operation text not null, correlation_id text not null, request_summary jsonb, response_summary jsonb,
 success boolean not null default false, error_code text, created_at timestamptz not null default now()
);
create table if not exists public.audit_logs (
 id uuid primary key default gen_random_uuid(), actor_id uuid, entity_type text not null, entity_id uuid, action text not null,
 before_summary jsonb, after_summary jsonb, source text not null default 'application', created_at timestamptz not null default now()
);
create index if not exists idx_recipients_document_number on public.recipients(document_number);
create index if not exists idx_addresses_recipient on public.delivery_addresses(recipient_id);
create index if not exists idx_fulfillments_status_created on public.fulfillments(status, created_at desc);
create index if not exists idx_shipments_tracking on public.shipments(tracking_code);
create index if not exists idx_events_fulfillment_created on public.integration_events(fulfillment_id, created_at desc);
create index if not exists idx_audit_entity_created on public.audit_logs(entity_type, entity_id, created_at desc);
alter table public.recipients enable row level security;
alter table public.delivery_addresses enable row level security;
alter table public.fulfillments enable row level security;
alter table public.invoices enable row level security;
alter table public.shipments enable row level security;
alter table public.integration_events enable row level security;
alter table public.audit_logs enable row level security;
comment on table public.recipients is 'Dados pessoais: acesso somente por backend autorizado.';
comment on table public.audit_logs is 'Trilha de auditoria: não armazenar segredos.';
