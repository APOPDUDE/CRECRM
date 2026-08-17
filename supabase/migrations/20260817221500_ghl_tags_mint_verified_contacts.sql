-- Rule (Alex, 2026-08-17): a 'buyer' or 'owner occupier' tag applied in GHL means the VA
-- reached this person on a call — the same evidence 'interested' carries. So those tags must
-- leave a VERIFIED contact in the CRM (verified_by 'ghl_va'), minting the contact when GHL
-- has someone the CRM never held. This is why Austin Taylor Jones was invisible: tagged
-- 'buyer' but never 'interested', so no flow ever created his contact.
--
-- Round-trip safety: the outbound push (push_tags_to_ghl) only targets contacts with
-- verified_at IS NOT NULL, so a CRM-originated tag echoing back through the inbound poll can
-- only touch already-verified contacts — verify-if-unverified is idempotent for those. Only a
-- human tagging in GHL can reach an unverified or unknown person.

-- One resolver for "this GHL contact must exist here, verified".
-- Match by ghl_contact_id, then phone, then email; mint when unknown and an identity
-- (phone or email — contacts_needs_identity) is present. Never overwrites an existing
-- verification (verified-upgrade rule: coalesce, don't clobber). Returns the contact id,
-- or null when there is no identity to key the person on.
create or replace function ghl_touch_verified_contact(p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ghl   text := nullif(btrim(coalesce(p->>'ghl_contact_id', '')), '');
  v_phone text := normalize_phone(p->>'phone');
  v_email text := nullif(btrim(coalesce(p->>'email', '')), '');
  v_first text := nullif(btrim(coalesce(p->>'first', '')), '');
  v_last  text := nullif(btrim(coalesce(p->>'last', '')), '');
  v_id    uuid;
begin
  if v_ghl is not null then
    select id into v_id from contacts where ghl_contact_id = v_ghl;
  end if;
  if v_id is null and v_phone is not null and length(v_phone) = 10 then
    select id into v_id from contacts
    where normalize_phone(phone) = v_phone
    order by created_at asc limit 1;
  end if;
  if v_id is null and v_email is not null then
    select id into v_id from contacts
    where lower(email) = lower(v_email)
    order by created_at asc limit 1;
  end if;

  if v_id is null then
    if v_phone is null and v_email is null then
      return null;
    end if;
    insert into contacts (first_name, last_name, phone, email, source, ghl_contact_id,
                          verified_at, verified_by, archived)
    values (coalesce(v_first, p->>'phone', v_email, 'Unknown'), v_last,
            nullif(btrim(coalesce(p->>'phone', '')), ''), v_email, 'ghl', v_ghl,
            now(), 'ghl_va', false)
    returning id into v_id;
    return v_id;
  end if;

  -- A verified contact belongs in the book; verification pair stays atomic per the CHECK.
  update contacts set
    ghl_contact_id = coalesce(ghl_contact_id, v_ghl),
    verified_at    = coalesce(verified_at, now()),
    verified_by    = coalesce(verified_by, 'ghl_va'),
    archived       = false
  where id = v_id
    and (ghl_contact_id is null or verified_at is null or archived);
  return v_id;
end $$;

-- Buyer tag → queue, now ALSO minting/verifying the contact. The queue semantics are
-- unchanged (nothing becomes a client until Alex fills the criteria); the difference is the
-- person now exists as a verified contact the moment the tag lands, and the intake carries
-- contact_id so the Buyers-page form prefills instead of asking for a retype.
create or replace function intake_buyer_tag(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ghl     text := nullif(btrim(coalesce(p->>'ghl_contact_id', '')), '');
  v_phone   text := normalize_phone(p->>'phone');
  v_email   text := nullif(btrim(coalesce(p->>'email', '')), '');
  v_first   text := nullif(btrim(coalesce(p->>'first', '')), '');
  v_last    text := nullif(btrim(coalesce(p->>'last', '')), '');
  v_company text := nullif(btrim(coalesce(p->>'company_name', '')), '');
  v_source  text := nullif(btrim(coalesce(p->>'source', '')), '');
  v_contact uuid;
  v_client  uuid;
  v_existing buyer_intakes;
  v_id      uuid;
begin
  if v_ghl is null then
    return jsonb_build_object('ok', false, 'error', 'ghl_contact_id required');
  end if;

  select * into v_existing from buyer_intakes where ghl_contact_id = v_ghl;
  if v_existing.id is not null then
    -- Re-send of a known tag: still make sure the person exists verified, and heal an
    -- intake that predates contact minting.
    v_contact := ghl_touch_verified_contact(p);
    if v_contact is not null and v_existing.contact_id is null then
      update buyer_intakes set contact_id = v_contact where id = v_existing.id;
    end if;
    return jsonb_build_object('ok', true, 'intake_id', v_existing.id,
                              'status', v_existing.status,
                              'contact_id', coalesce(v_existing.contact_id, v_contact),
                              'already', true);
  end if;

  -- The tag is a VA's word that a conversation happened: mint or verify the contact.
  v_contact := ghl_touch_verified_contact(p);

  if v_contact is not null then
    select id into v_client from clients
    where contact_id = v_contact
      and status in ('prospect', 'searching', 'negotiating')
    order by created_at asc limit 1;

    if v_client is null then
      select * into v_existing from buyer_intakes
      where contact_id = v_contact and status = 'pending' limit 1;
      if v_existing.id is not null then
        update buyer_intakes
        set ghl_contact_id = coalesce(ghl_contact_id, v_ghl),
            first_name     = coalesce(first_name, v_first),
            last_name      = coalesce(last_name, v_last),
            phone          = coalesce(phone, v_phone),
            email          = coalesce(email, v_email),
            company_name   = coalesce(company_name, v_company),
            raw            = coalesce(raw, p)
        where id = v_existing.id;
        return jsonb_build_object('ok', true, 'intake_id', v_existing.id, 'status', 'pending',
                                  'contact_id', v_contact, 'already', true);
      end if;
    end if;
  end if;

  insert into buyer_intakes (ghl_contact_id, contact_id, first_name, last_name, phone, email,
                             company_name, source, raw,
                             status, client_id, reviewed_at)
  values (v_ghl, v_contact, v_first, v_last, v_phone, v_email, v_company,
          case when v_source is not null and exists (
                 select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'lead_source' and e.enumlabel = v_source)
               then v_source::lead_source else null end,
          p,
          case when v_client is null then 'pending' else 'approved' end::buyer_intake_status,
          v_client,
          case when v_client is null then null else now() end)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'intake_id', v_id,
                            'status', case when v_client is null then 'pending' else 'approved' end,
                            'contact_id', v_contact, 'client_id', v_client,
                            'already_a_client', v_client is not null, 'already', false);
end $$;

-- Owner-occupier tag (add): mint/verify the contact before trying to place the property
-- tag. Placement can still fail soft ('no owner company for contact' / 'ambiguous_property'
-- stay silent in the poll) — but the person the VA talked to now exists, verified.
create or replace function apply_ghl_tag(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tag     text := lower(btrim(coalesce(p->>'tag', '')));
  v_action  text := lower(coalesce(nullif(p->>'action', ''), 'add'));
  v_ghl     text := nullif(btrim(coalesce(p->>'ghl_contact_id', '')), '');
  v_phone   text := normalize_phone(p->>'phone');
  v_contact uuid;
  v_company uuid;
  v_prop    uuid;
  v_props   int;
begin
  if v_tag = '' then
    return jsonb_build_object('ok', false, 'reason', 'no tag');
  end if;
  if v_action not in ('add', 'remove') then
    return jsonb_build_object('ok', false, 'reason', 'bad action: ' || v_action);
  end if;

  -- Adding 'owner occupier' is a human's report of a conversation (Alex 2026-08-17):
  -- resolve-or-mint the contact as verified. Other tags keep pure resolution.
  if v_action = 'add' and v_tag in ('owner occupier', 'owner-occupier') then
    v_contact := ghl_touch_verified_contact(p);
  end if;

  if v_contact is null and v_ghl is not null then
    select id into v_contact from contacts where ghl_contact_id = v_ghl;
  end if;
  if v_contact is null and v_phone is not null and length(v_phone) = 10 then
    select id into v_contact from contacts where normalize_phone(phone) = v_phone limit 1;
    if v_contact is not null and v_ghl is not null then
      update contacts set ghl_contact_id = v_ghl
      where id = v_contact and ghl_contact_id is null;
    end if;
  end if;

  if v_contact is null then
    return jsonb_build_object('ok', false, 'reason', 'contact not found',
                              'ghl_contact_id', v_ghl, 'phone', v_phone);
  end if;

  -- the owning entity is the company the contact is seated at (owners retired)
  select c.company_id into v_company from contacts c where c.id = v_contact;

  if v_company is null then
    return jsonb_build_object('ok', false, 'reason', 'no owner company for contact',
                              'contact_id', v_contact);
  end if;

  if v_tag in ('owner occupier', 'owner-occupier') then
    v_tag := 'owner occupier';
    select count(*) into v_props from properties where owner_company_id = v_company;
    if v_props = 0 then
      return jsonb_build_object('ok', false, 'reason', 'owner has no property',
                                'owner_id', v_company, 'company_id', v_company);
    end if;
    if v_props > 1 then
      return jsonb_build_object('ok', false, 'reason', 'ambiguous_property',
                                'owner_id', v_company, 'company_id', v_company,
                                'contact_id', v_contact,
                                'property_count', v_props, 'tag', v_tag);
    end if;
    select id into v_prop from properties where owner_company_id = v_company;

    if v_action = 'add' then
      update properties
      set tags = (select array_agg(distinct t) from unnest(coalesce(tags, '{}') || v_tag) t)
      where id = v_prop;
    else
      update properties
      set tags = nullif(array_remove(coalesce(tags, '{}'), v_tag), '{}')
      where id = v_prop;
    end if;

    return jsonb_build_object('ok', true, 'entity', 'property', 'property_id', v_prop,
                              'tag', v_tag, 'action', v_action);
  end if;

  if v_action = 'add' then
    update companies
    set tags = (select array_agg(distinct t) from unnest(coalesce(tags, '{}') || v_tag) t)
    where id = v_company;
  else
    update companies
    set tags = nullif(array_remove(coalesce(tags, '{}'), v_tag), '{}')
    where id = v_company;
  end if;

  return jsonb_build_object('ok', true, 'entity', 'owner', 'owner_id', v_company,
                            'company_id', v_company, 'tag', v_tag, 'action', v_action);
end $$;

-- Whole-list reconcile gets the same rule: an incoming list carrying 'owner occupier'
-- mints/verifies the contact before the company/property tag work.
create or replace function apply_ghl_tag_set(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  k_owner_tags text[] := array['interested', 'not interested'];
  k_oo      text := 'owner occupier';
  v_ghl     text := nullif(btrim(coalesce(p->>'ghl_contact_id', '')), '');
  v_phone   text := normalize_phone(p->>'phone');
  v_incoming text[];
  v_contact uuid;
  v_company uuid;
  v_prop    uuid;
  v_props   int;
  v_want_oo boolean;
  v_next    text[];
  v_changed jsonb := '[]'::jsonb;
  v_ambiguous boolean := false;
begin
  select coalesce(array_agg(distinct lower(btrim(t))), '{}')
    into v_incoming
  from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t
  where btrim(t) <> '';

  -- 'owner occupier' in the list = a human says they reached this person (Alex 2026-08-17).
  if k_oo = any(v_incoming) then
    v_contact := ghl_touch_verified_contact(p);
  end if;

  if v_contact is null and v_ghl is not null then
    select id into v_contact from contacts where ghl_contact_id = v_ghl;
  end if;
  if v_contact is null and v_phone is not null and length(v_phone) = 10 then
    select id into v_contact from contacts where normalize_phone(phone) = v_phone limit 1;
    if v_contact is not null and v_ghl is not null then
      update contacts set ghl_contact_id = v_ghl
      where id = v_contact and ghl_contact_id is null;
    end if;
  end if;

  if v_contact is null then
    return jsonb_build_object('ok', false, 'reason', 'contact not found',
                              'ghl_contact_id', v_ghl, 'phone', v_phone);
  end if;

  -- the owning entity is the company the contact is seated at (owners retired)
  select c.company_id into v_company from contacts c where c.id = v_contact;

  if v_company is null then
    return jsonb_build_object('ok', false, 'reason', 'no owner company for contact',
                              'contact_id', v_contact);
  end if;

  select nullif(coalesce(array_agg(distinct t), '{}'), '{}') into v_next
  from (
    select unnest(coalesce(c.tags, '{}')) t from companies c where c.id = v_company
    except
    select unnest(k_owner_tags)
    union
    select unnest(array(select unnest(v_incoming) intersect select unnest(k_owner_tags)))
  ) s(t);

  update companies set tags = v_next
  where id = v_company and tags is distinct from v_next;
  if found then
    v_changed := v_changed || jsonb_build_array(jsonb_build_object('entity', 'owner', 'owner_id', v_company, 'company_id', v_company, 'tags', to_jsonb(coalesce(v_next, '{}'))));
  end if;

  v_want_oo := k_oo = any(v_incoming);
  select count(*) into v_props from properties where owner_company_id = v_company;

  if v_want_oo then
    if v_props = 1 then
      select id into v_prop from properties where owner_company_id = v_company;
      -- k_oo is a declared text variable on purpose: a bare literal here makes Postgres
      -- resolve `array || unknown` as array||array and fail to parse the tag as one.
      update properties
      set tags = (select array_agg(distinct t) from unnest(coalesce(tags, '{}') || k_oo) t)
      where id = v_prop and not (k_oo = any(coalesce(tags, '{}')));
      if found then
        v_changed := v_changed || jsonb_build_array(jsonb_build_object('entity', 'property', 'property_id', v_prop, 'added', k_oo));
      end if;
    elsif v_props > 1 and not exists (
      select 1 from properties where owner_company_id = v_company and k_oo = any(coalesce(tags, '{}'))
    ) then
      v_ambiguous := true;
    end if;
  else
    update properties
    set tags = nullif(array_remove(coalesce(tags, '{}'), k_oo), '{}')
    where owner_company_id = v_company and k_oo = any(coalesce(tags, '{}'));
    if found then
      v_changed := v_changed || jsonb_build_array(jsonb_build_object('entity', 'property', 'removed', k_oo));
    end if;
  end if;

  return jsonb_build_object(
    'ok', not v_ambiguous,
    'reason', case when v_ambiguous then 'ambiguous_property' else null end,
    'contact_id', v_contact, 'owner_id', v_company, 'company_id', v_company,
    'property_count', v_props, 'tag', k_oo,
    'changed', v_changed
  );
end $$;

-- Backfill: pending buyer intakes queued before this rule. Mint/verify their contacts and
-- link them, so the queue prefills (Austin Taylor Jones, William Steven Gough) and
-- already-linked pending intakes (Matthew Terrance Coyle) get their verification stamped.
with touched as (
  select bi.id,
         ghl_touch_verified_contact(jsonb_build_object(
           'ghl_contact_id', bi.ghl_contact_id,
           'phone', bi.phone,
           'email', bi.email,
           'first', bi.first_name,
           'last', bi.last_name)) as cid
  from buyer_intakes bi
  where bi.status = 'pending'
)
update buyer_intakes bi
set contact_id = t.cid
from touched t
where bi.id = t.id and bi.contact_id is null and t.cid is not null;
