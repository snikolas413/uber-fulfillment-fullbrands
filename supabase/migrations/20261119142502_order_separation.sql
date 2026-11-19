alter table public.fulfillments
  add column separation_state text not null default 'none'
    check (separation_state in ('none','processing','unknown','confirmed')),
  add column separation_omie_stage text check (separation_omie_stage in ('10','20','30','40')),
  add column separation_confirmed_at timestamptz;
alter table public.fulfillments add constraint separation_confirmation_complete
  check (separation_state <> 'confirmed' or (separation_omie_stage is not null and separation_confirmed_at is not null));
comment on column public.fulfillments.separation_state is 'Envio para separação: resultado incerto é reconferido por leitura, sem repetir a troca de etapa.';
