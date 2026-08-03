-- ghl_verify_owner v2: when the matched property has no owner entity yet (the ~1.1k
-- unenriched rows), MINT the owner instead of refusing -- a human verified on that parcel IS
-- the ownership evidence, same rule as the HubSpot deal-counterparty pass. Prefers an explicit
-- owner_name (GHL custom field, usually the county entity) over the contact's own name.
-- First live case: John Buntin -> "Vantage Property Holdings Llc" / 5101 24th Ave S, 2026-08-03.
-- (Full function body applied live via MCP 2026-08-03; identical to this file.)
create or replace function ghl_verify_owner(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text := coalesce(nullif(p->>'status', ''), 'verified');
  v_parcel   text := nullif(btrim(coalesce(p->>'parcel', '')), '');
  v_addr     text := nullif(btrim(coalesce(p->>'address', '')), '');
  v_city     text := nullif(btrim(coalesce(p->>'city', '')), '');
  v_phone    text := normalize_phone(p->>'phone');
  v_first    text := nullif(btrim(coalesce(p->>'first', '')), '');
  v_last     text := nullif(btrim(coalesce(p->>'last', '')), '');
  v_email    text := nullif(btrim(coalesce(p->>'email', '')), '');
  v_ghl      text := nullif(btrim(coalesce(p->>'ghl_contact_id', '')), '');
  v_notes    text := nullif(btrim(coalesce(p->>'notes', '')), '');
  v_oname    text := nullif(btrim(coalesce(p->>'owner_name', '')), '');
  v_prop     properties;
  v_owner    uuid;
  v_contact  uuid;
  v_mint     text;
begin
  if v_status not in ('verified', 'unreachable', 'do_not_call') then
    return jsonb_build_object('ok', false, 'error', 'bad status: ' || v_status);
  end if;

  if v_parcel is not null then
    select * into v_prop from properties where parcel_number = v_parcel limit 1;
  end if;
  if v_prop.id is null and v_addr is not null then
    select * into v_prop from properties
    where normalize_street(address) = normalize_street(v_addr)
      and (v_city is null or city is null or upper(btrim(city)) = upper(v_city))
    limit 1;
  end if;
  if v_prop.id is null then
    return jsonb_build_object('ok', false, 'error', 'property not found',
                              'tried_parcel', v_parcel, 'tried_address', v_addr);
  end if;

  v_owner := v_prop.owner_id;

  -- owner-less parcel: mint the entity from what the verification told us
  if v_owner is null then
    v_mint := coalesce(v_oname,
                       nullif(btrim(coalesce(v_first, '') || ' ' || coalesce(v_last, '')), ''));
    if v_mint is null or v_mint = 'Unknown' then
      return jsonb_build_object('ok', false, 'error', 'property has no owner entity and no name to mint one',
                                'property_id', v_prop.id);
    end if;
    insert into owners (display_name, kind)
    values (v_mint, 'unknown')
    on conflict (normalized_name) do nothing;
    select id into v_owner from owners where normalized_name = normalize_owner_name(v_mint);
    update properties set owner_id = v_owner, owner_name = coalesce(owner_name, v_mint)
    where id = v_prop.id;
  end if;

  if v_status in ('unreachable', 'do_not_call') then
    update owners
    set verification_status = v_status::owner_verification_status,
        verification_note = coalesce(v_notes, verification_note),
        verification_updated_at = now()
    where id = v_owner;
    if v_status = 'do_not_call' and v_phone is not null then
      update contacts set do_not_call = true where normalize_phone(phone) = v_phone;
    end if;
    return jsonb_build_object('ok', true, 'owner_id', v_owner, 'status', v_status);
  end if;

  if v_phone is null and v_ghl is null then
    return jsonb_build_object('ok', false, 'error', 'verified needs a phone or ghl_contact_id');
  end if;

  select id into v_contact from contacts
  where (v_phone is not null and normalize_phone(phone) = v_phone) limit 1;

  if v_contact is null then
    insert into contacts (first_name, last_name, phone, email, source_system)
    values (coalesce(v_first, 'Unknown'), v_last, v_phone, v_email, 'ghl')
    returning id into v_contact;
  else
    update contacts c
    set first_name = case when c.first_name in ('Unknown','') or c.first_name is null
                          then coalesce(v_first, c.first_name) else c.first_name end,
        last_name  = coalesce(c.last_name, v_last),
        email      = coalesce(c.email, v_email)
    where c.id = v_contact;
  end if;

  insert into owner_contacts (owner_id, contact_id, role, confidence, match_basis,
                              verified_at, verified_by, notes)
  values (v_owner, v_contact, coalesce(nullif(p->>'role',''), 'owner'), 'confirmed',
          'ghl_va_call', now(), 'ghl_va', v_notes)
  on conflict (owner_id, contact_id) do update
    set confidence = 'confirmed',
        verified_at = coalesce(owner_contacts.verified_at, now()),
        verified_by = coalesce(owner_contacts.verified_by, 'ghl_va'),
        match_basis = 'ghl_va_call',
        notes = coalesce(excluded.notes, owner_contacts.notes);

  update owners
  set verification_status = 'verified',
      verification_note = coalesce(v_notes, verification_note),
      verification_updated_at = now()
  where id = v_owner;

  if v_notes is not null then
    insert into communications (contact_id, phone, owner_id, property_id, channel, direction,
                                occurred_at, body, source, external_id)
    values (v_contact, v_phone, v_owner, v_prop.id, 'call', 'outbound', now(),
            v_notes, 'ghl',
            'verify:' || coalesce(v_ghl, v_phone, v_contact::text) || ':' ||
            substr(md5(v_notes), 1, 12))
    on conflict (source, external_id) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'owner_id', v_owner, 'contact_id', v_contact,
                            'property_id', v_prop.id, 'status', 'verified');
end $$;
