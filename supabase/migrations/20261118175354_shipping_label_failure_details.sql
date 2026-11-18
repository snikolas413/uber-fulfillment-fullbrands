alter table public.shipments
  add column if not exists label_last_error text check (length(label_last_error) <= 1200),
  add column if not exists label_error_at timestamptz;
comment on column public.shipments.label_last_error is 'Última falha da etiqueta, preservada até conclusão bem-sucedida; não altera a situação de geração.';
