-- Property-level tags (owner occupier and friends) + the GHL round-trip they need,
-- and a fix for verified contacts that stayed archived.
--
-- Why tags live on the PROPERTY and not the owner: "owner occupier" describes a
-- building, not a person. 517 of our 2,974 contact-bearing owners hold more than one
-- property, and an owner who occupies one site and leases four others would be
-- mislabelled on all five if the tag sat on `owners`. `owners.tags` keeps its existing
-- outcome vocabulary (interested / not interested) -- that is about the PERSON and is
-- correctly owner-level.

-- ---------------------------------------------------------------------------
-- 1. Cache the canonical GHL contact id.
-- ---------------------------------------------------------------------------
-- GHL holds one row per skip-traced phone: Angela Miller exists there FOUR times for
-- one CRM contact, and only the number she actually answered carries her tags. The
-- outbound push has to know which of those rows to write to, so we record the id the
-- inbound call resolved rather than re-searching (and re-guessing) every time.
alter table contacts add column if not exists ghl_contact_id text;

create unique index if not exists contacts_ghl_contact_id_key
  on contacts (ghl_contact_id) where ghl_contact_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Property tags.
-- ---------------------------------------------------------------------------
alter table properties add column if not exists tags text[];

create index if not exists properties_tags_idx on properties using gin (tags);

comment on column properties.tags is
  'Free-text property tags (owner occupier, ...). Person-level outcome tags live on owners.tags.';

-- ---------------------------------------------------------------------------
-- 3. Verified contacts must not stay archived.
-- ---------------------------------------------------------------------------
-- The 2026-08-10 sweep archived every contact with no evidence behind it (a phone
-- number alone is not evidence). `ghl_verify_owner` then started minting evidence --
-- a confirmed owner_contacts row -- without ever clearing the flag, so a contact the
-- VA had just spoken to stayed hidden. `mark_contact_as_buyer` already unarchives for
-- exactly this reason; verification is the same promotion and must behave the same.

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
  v_owner    uuid;
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

  v_owner := v_prop.owner_id;

  if v_status = 'wrong_person' then
    if v_phone is null then
      return jsonb_build_object('ok', false, 'error', 'wrong_person needs a phone');
    end if;
    select id into v_contact from contacts where normalize_phone(phone) = v_phone limit 1;
    if v_contact is not null then
      if v_owner is not null then
        delete from owner_contacts where owner_id = v_owner and contact_id = v_contact;
      end if;
      insert into communications (contact_id, phone, owner_id, property_id, channel, direction,
                                  occurred_at, body, source, external_id)
      values (v_contact, v_phone, v_owner, v_prop.id, 'note', 'unknown', now(),
              '[GHL tag: wrong person]' || coalesce(E'\n' || v_notes, ''), 'ghl',
              'wrong:' || coalesce(v_ghl, v_phone) || ':' || substr(md5(now()::text), 1, 8))
      on conflict (source, external_id) do nothing;
    end if;
    if v_owner is not null then
      update owners o set verification_status = 'unverified', verification_updated_at = now()
      where o.id = v_owner and o.verification_status = 'verified'
        and not exists (select 1 from owner_contacts oc
                        where oc.owner_id = o.id and oc.confidence = 'confirmed');
    end if;
    return jsonb_build_object('ok', true, 'owner_id', v_owner, 'contact_id', v_contact,
                              'status', 'wrong_person');
  end if;

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
    insert into contacts (first_name, last_name, phone, email, source_system, ghl_contact_id)
    values (coalesce(v_first, 'Unknown'), v_last, v_phone, v_email, 'ghl', v_ghl)
    returning id into v_contact;
  else
    -- archived = false: a verified conversation IS the evidence the sweep wanted.
    update contacts c
    set first_name = case when c.first_name in ('Unknown','') or c.first_name is null
                          then coalesce(v_first, c.first_name) else c.first_name end,
        last_name  = coalesce(c.last_name, v_last),
        email      = coalesce(c.email, v_email),
        ghl_contact_id = coalesce(c.ghl_contact_id, v_ghl),
        archived   = false
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
      verification_updated_at = now(),
      tags = case when v_tag is null then tags
                  else (select array_agg(distinct t) from unnest(coalesce(tags, '{}') || v_tag) t) end
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
end $function$;

-- ---------------------------------------------------------------------------
-- 4. Backfill: unarchive the contacts the VA already verified.
-- ---------------------------------------------------------------------------
update contacts c
set archived = false
where c.archived
  and exists (select 1 from owner_contacts oc
              where oc.contact_id = c.id and oc.confidence = 'confirmed');
