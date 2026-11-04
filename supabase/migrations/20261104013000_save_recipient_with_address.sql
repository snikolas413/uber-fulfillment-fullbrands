create or replace function public.save_recipient_with_address(
  p_recipient_id uuid,
  p_full_name text,
  p_document_number text,
  p_email text,
  p_phone text,
  p_postal_code text,
  p_street text,
  p_number text,
  p_complement text,
  p_district text,
  p_city text,
  p_state text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_recipient_id uuid;
  v_existing public.recipients%rowtype;
  v_latest_address public.delivery_addresses%rowtype;
  v_contact_changed boolean := false;
  v_address_changed boolean := false;
  v_action text;
begin
  if auth.uid() is null then
    raise exception using message = 'AUTH_REQUIRED', errcode = '28000';
  end if;

  if not private.user_has_role(array['admin', 'gestor', 'operador']) then
    raise exception using message = 'FORBIDDEN', errcode = '42501';
  end if;

  if nullif(btrim(p_full_name), '') is null then
    raise exception using message = 'FULL_NAME_REQUIRED', errcode = '22023';
  end if;
  if p_postal_code !~ '^[0-9]{8}$' then
    raise exception using message = 'INVALID_POSTAL_CODE', errcode = '22023';
  end if;
  if nullif(btrim(p_street), '') is null
    or nullif(btrim(p_number), '') is null
    or nullif(btrim(p_district), '') is null
    or nullif(btrim(p_city), '') is null then
    raise exception using message = 'ADDRESS_FIELDS_REQUIRED', errcode = '22023';
  end if;
  if upper(btrim(p_state)) !~ '^[A-Z]{2}$' then
    raise exception using message = 'INVALID_STATE', errcode = '22023';
  end if;

  if p_recipient_id is null then
    insert into public.recipients (
      full_name, document_number, email, phone
    ) values (
      btrim(p_full_name),
      nullif(btrim(p_document_number), ''),
      nullif(btrim(p_email), ''),
      nullif(btrim(p_phone), '')
    )
    returning id into v_recipient_id;

    v_contact_changed := true;
    v_action := 'recipient.created';
  else
    select *
      into v_existing
      from public.recipients
     where id = p_recipient_id
     for update;

    if not found then
      raise exception using message = 'RECIPIENT_NOT_FOUND', errcode = 'P0002';
    end if;

    v_recipient_id := p_recipient_id;
    v_contact_changed :=
      row(v_existing.full_name, v_existing.document_number, v_existing.email, v_existing.phone)
      is distinct from
      row(
        btrim(p_full_name),
        nullif(btrim(p_document_number), ''),
        nullif(btrim(p_email), ''),
        nullif(btrim(p_phone), '')
      );

    if v_contact_changed then
      update public.recipients
         set full_name = btrim(p_full_name),
             document_number = nullif(btrim(p_document_number), ''),
             email = nullif(btrim(p_email), ''),
             phone = nullif(btrim(p_phone), ''),
             updated_at = now()
       where id = v_recipient_id;
    end if;

    v_action := 'recipient.updated';
  end if;

  select *
    into v_latest_address
    from public.delivery_addresses
   where recipient_id = v_recipient_id
   order by created_at desc, id desc
   limit 1;

  if not found then
    v_address_changed := true;
  else
    v_address_changed :=
      row(
        v_latest_address.postal_code,
        v_latest_address.street,
        v_latest_address.number,
        v_latest_address.complement,
        v_latest_address.district,
        v_latest_address.city,
        v_latest_address.state
      )
      is distinct from
      row(
        btrim(p_postal_code),
        btrim(p_street),
        btrim(p_number),
        nullif(btrim(p_complement), ''),
        btrim(p_district),
        btrim(p_city),
        upper(btrim(p_state))
      );
  end if;

  if v_address_changed then
    insert into public.delivery_addresses (
      recipient_id, postal_code, street, number, complement,
      district, city, state, country, validation_status
    ) values (
      v_recipient_id,
      btrim(p_postal_code),
      btrim(p_street),
      btrim(p_number),
      nullif(btrim(p_complement), ''),
      btrim(p_district),
      btrim(p_city),
      upper(btrim(p_state)),
      'BR',
      'pending'
    );
  end if;

  if v_contact_changed or v_address_changed then
    insert into public.audit_logs (
      actor_id, entity_type, entity_id, action, after_summary, source
    ) values (
      auth.uid(),
      'recipient',
      v_recipient_id,
      v_action,
      jsonb_build_object(
        'contact_changed', v_contact_changed,
        'address_version_created', v_address_changed
      ),
      'application'
    );
  end if;

  return v_recipient_id;
end;
$function$;

revoke all on function public.save_recipient_with_address(
  uuid, text, text, text, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.save_recipient_with_address(
  uuid, text, text, text, text, text, text, text, text, text, text, text
) to authenticated;
