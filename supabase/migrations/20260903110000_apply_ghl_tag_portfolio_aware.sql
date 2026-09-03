-- apply_ghl_tag: an owner-occupier tag reaches the property through the PORTFOLIO.
--
-- Ugur Ozer (verified) sits under his own entity; 7720 N 301 Hwy is deeded to Ozer
-- Investments LLC. The two were linked as one portfolio (link_owner_portfolio, 2026-09-03)
-- but this function still looked only at the contact's own company, so every GHL tag poll
-- posted "owner has no property" to Slack. Same rule the rollup already uses:
-- properties where owner_company_id = any(portfolio_company_ids(contact.company_id)).
-- Body otherwise unchanged from the live definition.

CREATE OR REPLACE FUNCTION public.apply_ghl_tag(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tag     text := lower(btrim(coalesce(p->>'tag', '')));
  v_action  text := lower(coalesce(nullif(p->>'action', ''), 'add'));
  v_ghl     text := nullif(btrim(coalesce(p->>'ghl_contact_id', '')), '');
  v_phone   text := normalize_phone(p->>'phone');
  v_contact uuid;
  v_company uuid;
  v_owners  uuid[];
  v_prop    uuid;
  v_props   int;
begin
  if v_tag = '' then
    return jsonb_build_object('ok', false, 'reason', 'no tag');
  end if;
  if v_action not in ('add', 'remove') then
    return jsonb_build_object('ok', false, 'reason', 'bad action: ' || v_action);
  end if;

  if v_action = 'add' and v_tag in ('owner occupier', 'owner-occupier', 'buyer') then
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

  select c.company_id into v_company from contacts c where c.id = v_contact;

  if v_company is null then
    return jsonb_build_object('ok', false, 'reason', 'no owner company for contact',
                              'contact_id', v_contact);
  end if;

  -- the person's own entity plus every deed entity in the same portfolio
  v_owners := portfolio_company_ids(v_company);

  if v_tag in ('owner occupier', 'owner-occupier') then
    v_tag := 'owner occupier';
    select count(*) into v_props from properties where owner_company_id = any(v_owners);
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
    select id into v_prop from properties where owner_company_id = any(v_owners);

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
                              'contact_id', v_contact,
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
                            'company_id', v_company, 'contact_id', v_contact,
                            'tag', v_tag, 'action', v_action);
end $function$;
