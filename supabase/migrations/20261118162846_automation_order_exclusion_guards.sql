-- Enforce authorized automation exclusions independently of the application UI.
-- No foreign keys: blocks must survive removal/reimport of business records.
create table private.automation_order_blocks (
  document_number text primary key check (document_number ~ '^[0-9]{11}$'),
  recipient_id uuid not null unique,
  fulfillment_id uuid not null unique,
  omie_order_id bigint unique,
  reason text not null,
  blocked_at timestamptz not null default now()
);
alter table private.automation_order_blocks enable row level security;
revoke all on private.automation_order_blocks from public, anon, authenticated, service_role;

-- SECURITY DEFINER is required to inspect the private deny list for all callers,
-- including authenticated operators. This function is trigger-only, has no API
-- grants, uses a fixed search path, and never writes or returns private data.
create function private.enforce_automation_order_block()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  document_digits text;
begin
  if tg_table_schema <> 'public' then
    raise exception 'INVALID_BLOCK_TRIGGER';
  end if;
  if tg_table_name = 'fulfillments' then
    select regexp_replace(r.document_number, '[^0-9]', '', 'g')
      into document_digits from public.recipients r where r.id = new.recipient_id;
    if length(document_digits) between 1 and 11 then
      document_digits := lpad(document_digits, 11, '0');
    end if;
    if exists (
      select 1 from private.automation_order_blocks b
      where b.document_number = document_digits or b.recipient_id = new.recipient_id
        or b.fulfillment_id = new.id or b.omie_order_id = new.omie_order_id
    ) then
      raise exception using errcode = 'P0001',
        message = 'Pedido/CPF bloqueado para preparação, envio e faturamento pela automação.';
    end if;
  elsif tg_table_name = 'invoices' then
    if exists (select 1 from private.automation_order_blocks b where b.fulfillment_id = new.fulfillment_id) then
      raise exception using errcode = 'P0001',
        message = 'Faturamento bloqueado: pedido excluído da automação por solicitação do responsável.';
    end if;
  else
    raise exception 'INVALID_BLOCK_TRIGGER';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_automation_order_block() from public, anon, authenticated, service_role;
create trigger enforce_automation_order_block before insert or update on public.fulfillments
  for each row execute function private.enforce_automation_order_block();
create trigger enforce_automation_invoice_block before insert or update on public.invoices
  for each row execute function private.enforce_automation_order_block();
