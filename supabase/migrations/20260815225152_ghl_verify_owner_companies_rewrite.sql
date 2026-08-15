-- STAGE 2b end-game (2a): ghl_verify_owner rewritten on companies/contacts only.
--
-- Response JSON keys are IDENTICAL to the owners-era body (the n8n Slack flow and the
-- ghl-verify edge function consume it); where it returned owner_id it now returns the
-- owning COMPANY id — consumers treat the value as opaque.
--
-- Semantics mapping:
--   owning entity            = properties.owner_company_id; when null, find-or-create a
--                              companies row (type owning_entity, source county_appraiser,
--                              entity_kind 'unknown' — the old owners mint used kind
--                              'unknown') from owner_name/minted name, exactly like the
--                              retired owners-mint + mirror path.
--   verified                 = contact upserted by phone identity, verified_at/verified_by
--                              'ghl_va' stamped fill-only, seated at the company fill-only,
--                              archived cleared; outcome tag lands on companies.tags (the
--                              owners.tags analog — companies_push_tags posts it once).
--   wrong_person             = the owner_contacts-link delete becomes an un-seat of the
--                              contact from THIS company only; the note communication is
--                              kept (owner_company_id instead of the dying owner_id).
--   unreachable/do_not_call  = no companies-side status column exists (the enum retires);
--                              do_not_call still stamps the matching contacts. Response
--                              unchanged.
--   verification_note        = retired with owners; the notes text still lands in the
--                              logged communication, as before.

create or replace function public.ghl_verify_owner(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status   text := replace(coalesce(nullif(p->>'status', ''), 'verified'), ' ', '_');
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
  v_tag      text := lower(nullif(btrim(coalesce(p->>'tag', '')), ''));
  v_prop     properties;
  v_company  uuid;
  v_contact  uuid;
  v_mint     text;
begin
  if v_status not in ('verified', 'unreachable', 'do_not_call', 'wrong_person') then
    return jsonb_build_object('ok', false, 'error', 'bad status: ' || v_status);
  end if;

  select * into v_prop from properties where id = find_property(v_parcel, v_addr, v_city);
  if v_prop.id is null then
    return jsonb_build_object('ok', false, 'error', 'property not found',
                              'tried_parcel', v_parcel, 'tried_address', v_addr,
                              'tried_city', v_city);
  end if;

  v_company := v_prop.owner_company_id;

  if v_status = 'wrong_person' then
    if v_phone is null then
      return jsonb_build_object('ok', false, 'error', 'wrong_person needs a phone');
    end if;
    select id into v_contact from contacts where normalize_phone(phone) = v_phone limit 1;
    if v_contact is not null then
      if v_company is not null then
        -- the owner_contacts-link delete, translated: un-seat from THIS owning company only
        update contacts set company_id = null
        where id = v_contact and company_id = v_company;
      end if;
      insert into communications (contact_id, phone, owner_company_id, property_id, channel, direction,
                                  occurred_at, body, source, external_id)
      values (v_contact, v_phone, v_company, v_prop.id, 'note', 'unknown', now(),
              '[GHL tag: wrong person]' || coalesce(E'\n' || v_notes, ''), 'ghl',
              'wrong:' || coalesce(v_ghl, v_phone) || ':' || substr(md5(now()::text), 1, 8))
      on conflict (source, external_id) do nothing;
    end if;
    return jsonb_build_object('ok', true, 'owner_id', v_company, 'contact_id', v_contact,
                              'status', 'wrong_person');
  end if;

  if v_company is null then
    v_mint := coalesce(v_oname,
                       nullif(btrim(coalesce(v_first, '') || ' ' || coalesce(v_last, '')), ''));
    if v_mint is null or v_mint = 'Unknown' then
      return jsonb_build_object('ok', false, 'error', 'property has no owner entity and no name to mint one',
                                'property_id', v_prop.id);
    end if;
    select id into v_company from companies
    where normalized_name = normalize_owner_name(v_mint)
    order by created_at limit 1;
    if v_company is null then
      insert into companies (name, type, source, entity_kind, mailing_address)
      values (v_mint, 'owning_entity', 'county_appraiser', 'unknown', v_prop.owner_mailing_address)
      returning id into v_company;
    end if;
    update properties set owner_company_id = v_company, owner_name = coalesce(owner_name, v_mint)
    where id = v_prop.id;
  end if;

  if v_status in ('unreachable', 'do_not_call') then
    if v_status = 'do_not_call' and v_phone is not null then
      update contacts set do_not_call = true where normalize_phone(phone) = v_phone;
    end if;
    return jsonb_build_object('ok', true, 'owner_id', v_company, 'status', v_status);
  end if;

  if v_phone is null and v_ghl is null then
    return jsonb_build_object('ok', false, 'error', 'verified needs a phone or ghl_contact_id');
  end if;

  select id into v_contact from contacts
  where (v_phone is not null and normalize_phone(phone) = v_phone) limit 1;

  if v_contact is null then
    insert into contacts (first_name, last_name, phone, email, source_system, ghl_contact_id, verified_at, verified_by)
    values (coalesce(v_first, 'Unknown'), v_last, v_phone, v_email, 'ghl', v_ghl, now(), 'ghl_va')
    returning id into v_contact;
  else
    update contacts c
    set first_name = case when c.first_name in ('Unknown','') or c.first_name is null
                          then coalesce(v_first, c.first_name) else c.first_name end,
        last_name  = coalesce(c.last_name, v_last),
        email      = coalesce(c.email, v_email),
        ghl_contact_id = coalesce(c.ghl_contact_id, v_ghl),
        verified_at = coalesce(c.verified_at, now()),
        verified_by = coalesce(c.verified_by, 'ghl_va'),
        archived   = false
    where c.id = v_contact;
  end if;

  -- seat the person at the owning company, fill-only (never clobber a real affiliation)
  update contacts set company_id = v_company
  where id = v_contact and company_id is null;

  -- outcome tag: the owners.tags analog lives on the company now
  if v_tag is not null then
    update companies
    set tags = (select array_agg(distinct t) from unnest(coalesce(tags, '{}') || v_tag) t)
    where id = v_company;
  end if;

  if v_notes is not null then
    insert into communications (contact_id, phone, owner_company_id, property_id, channel, direction,
                                occurred_at, body, source, external_id)
    values (v_contact, v_phone, v_company, v_prop.id, 'call', 'outbound', now(),
            v_notes, 'ghl',
            'verify:' || coalesce(v_ghl, v_phone, v_contact::text) || ':' ||
            substr(md5(v_notes), 1, 12))
    on conflict (source, external_id) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'owner_id', v_company, 'contact_id', v_contact,
                            'property_id', v_prop.id, 'status', 'verified');
end $function$;
