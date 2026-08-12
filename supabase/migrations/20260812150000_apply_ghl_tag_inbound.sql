-- Inbound half of the two-way tag sync: a tag added or removed on a GHL contact lands
-- on the right CRE CRM record.
--
-- The hard part is that GHL only has CONTACTS, while our tags live on two different
-- things. `owner occupier` describes a building and belongs on properties.tags;
-- `interested` / `not interested` describe the person and belong on owners.tags. So the
-- same GHL tag event routes to a different table depending on the tag.
--
-- The genuinely ambiguous case is a property tag on an owner who holds several
-- buildings: GHL cannot say WHICH one is owner-occupied. Rather than guess or fan the
-- tag across a whole portfolio, that returns ok=false with reason 'ambiguous_property'
-- and the n8n caller tells Alex. 517 of 2,974 contact-bearing owners are multi-property,
-- so this is not a rare branch.

create or replace function public.apply_ghl_tag(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tag     text := lower(btrim(coalesce(p->>'tag', '')));
  v_action  text := lower(coalesce(nullif(p->>'action', ''), 'add'));
  v_ghl     text := nullif(btrim(coalesce(p->>'ghl_contact_id', '')), '');
  v_phone   text := normalize_phone(p->>'phone');
  v_contact uuid;
  v_owner   uuid;
  v_prop    uuid;
  v_props   int;
begin
  if v_tag = '' then
    return jsonb_build_object('ok', false, 'reason', 'no tag');
  end if;
  if v_action not in ('add', 'remove') then
    return jsonb_build_object('ok', false, 'reason', 'bad action: ' || v_action);
  end if;

  -- Identity: the cached GHL id first, then an EXACT 10-digit phone. Never a fuzzy
  -- match -- GHL keeps one contact per skip-traced number, so a loose match lands on
  -- the wrong one of a person's own duplicates.
  if v_ghl is not null then
    select id into v_contact from contacts where ghl_contact_id = v_ghl;
  end if;
  if v_contact is null and v_phone is not null and length(v_phone) = 10 then
    select id into v_contact from contacts where normalize_phone(phone) = v_phone limit 1;
    -- Remember which GHL row this was, so the outbound push can aim at it later.
    if v_contact is not null and v_ghl is not null then
      update contacts set ghl_contact_id = v_ghl
      where id = v_contact and ghl_contact_id is null;
    end if;
  end if;

  if v_contact is null then
    return jsonb_build_object('ok', false, 'reason', 'contact not found',
                              'ghl_contact_id', v_ghl, 'phone', v_phone);
  end if;

  select oc.owner_id into v_owner
  from owner_contacts oc
  where oc.contact_id = v_contact and oc.confidence = 'confirmed'
  limit 1;

  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'no confirmed owner link',
                              'contact_id', v_contact);
  end if;

  -- Property-level vocabulary. Everything else is treated as a person-level outcome tag.
  if v_tag in ('owner occupier', 'owner-occupier') then
    v_tag := 'owner occupier';
    select count(*) into v_props from properties where owner_id = v_owner;
    if v_props = 0 then
      return jsonb_build_object('ok', false, 'reason', 'owner has no property',
                                'owner_id', v_owner);
    end if;
    if v_props > 1 then
      return jsonb_build_object('ok', false, 'reason', 'ambiguous_property',
                                'owner_id', v_owner, 'contact_id', v_contact,
                                'property_count', v_props, 'tag', v_tag);
    end if;
    select id into v_prop from properties where owner_id = v_owner;

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
    update owners
    set tags = (select array_agg(distinct t) from unnest(coalesce(tags, '{}') || v_tag) t)
    where id = v_owner;
  else
    update owners
    set tags = nullif(array_remove(coalesce(tags, '{}'), v_tag), '{}')
    where id = v_owner;
  end if;

  return jsonb_build_object('ok', true, 'entity', 'owner', 'owner_id', v_owner,
                            'tag', v_tag, 'action', v_action);
end $function$;

comment on function public.apply_ghl_tag(jsonb) is
  'Inbound GHL tag -> CRE CRM. owner occupier routes to properties.tags (unambiguous owners only); other tags to owners.tags. Called by n8n /webhook/crm-tag-inbound.';
