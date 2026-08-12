-- Reconcile a GHL contact's WHOLE tag list into the CRE CRM, instead of applying one
-- tag event at a time.
--
-- Why: GHL's Contact Tag trigger does not expose which tag fired as a merge field, so
-- the per-event design needed one workflow per tag per direction -- six hand-built
-- workflows for three tags. It DOES expose {{contact.tags}}, the full current list. So
-- one workflow sends everything and Postgres works out the difference. One workflow,
-- both directions, and it stays correct if a tag is added and removed faster than the
-- webhooks arrive, because the last message wins rather than replaying an order.
--
-- Only the MANAGED vocabulary is reconciled. GHL carries plenty of tags that are not
-- ours -- owner-synced, owner-verified, buyer, blast-* -- and a blind reconcile would
-- both delete CRM tags GHL never had and import campaign plumbing as CRM state.

create or replace function public.apply_ghl_tag_set(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  k_owner_tags text[] := array['interested', 'not interested'];
  k_prop_tags  text[] := array['owner occupier'];
  v_ghl     text := nullif(btrim(coalesce(p->>'ghl_contact_id', '')), '');
  v_phone   text := normalize_phone(p->>'phone');
  v_incoming text[];
  v_contact uuid;
  v_owner   uuid;
  v_prop    uuid;
  v_props   int;
  v_want_oo boolean;
  v_changed jsonb := '[]'::jsonb;
  v_ambiguous boolean := false;
begin
  select coalesce(array_agg(distinct lower(btrim(t))), '{}')
    into v_incoming
  from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t
  where btrim(t) <> '';

  if v_ghl is not null then
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

  select oc.owner_id into v_owner
  from owner_contacts oc
  where oc.contact_id = v_contact and oc.confidence = 'confirmed'
  limit 1;

  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'no confirmed owner link',
                              'contact_id', v_contact);
  end if;

  -- Person-level tags: the owner's managed tags become exactly what GHL has, while any
  -- unmanaged tag already on the owner is preserved.
  update owners o
  set tags = nullif(
        (select coalesce(array_agg(distinct t), '{}')
         from (
           select unnest(coalesce(o.tags, '{}')) t
           except select unnest(k_owner_tags)
           union
           select unnest(array(select unnest(v_incoming) intersect select unnest(k_owner_tags)))
         ) s(t)
        ), '{}')
  where o.id = v_owner
    and o.tags is distinct from nullif(
        (select coalesce(array_agg(distinct t), '{}')
         from (
           select unnest(coalesce(o.tags, '{}')) t
           except select unnest(k_owner_tags)
           union
           select unnest(array(select unnest(v_incoming) intersect select unnest(k_owner_tags)))
         ) s(t)
        ), '{}');

  if found then
    v_changed := v_changed || jsonb_build_array(jsonb_build_object('entity', 'owner', 'owner_id', v_owner));
  end if;

  -- Property-level: 'owner occupier'.
  v_want_oo := 'owner occupier' = any(v_incoming);
  select count(*) into v_props from properties where owner_id = v_owner;

  if v_want_oo then
    if v_props = 1 then
      select id into v_prop from properties where owner_id = v_owner;
      update properties
      set tags = (select array_agg(distinct t) from unnest(coalesce(tags, '{}') || 'owner occupier') t)
      where id = v_prop and not ('owner occupier' = any(coalesce(tags, '{}')));
      if found then
        v_changed := v_changed || jsonb_build_array(jsonb_build_object('entity', 'property', 'property_id', v_prop, 'added', 'owner occupier'));
      end if;
    elsif v_props > 1 and not exists (
      select 1 from properties where owner_id = v_owner and 'owner occupier' = any(coalesce(tags, '{}'))
    ) then
      -- GHL says this person is an owner occupier but holds several buildings, and none
      -- is tagged yet. GHL has no way to say WHICH one, so this is Alex's call.
      v_ambiguous := true;
    end if;
  else
    -- GHL dropped it: clear it from whichever of their buildings carried it.
    update properties
    set tags = nullif(array_remove(coalesce(tags, '{}'), 'owner occupier'), '{}')
    where owner_id = v_owner and 'owner occupier' = any(coalesce(tags, '{}'));
    if found then
      v_changed := v_changed || jsonb_build_array(jsonb_build_object('entity', 'property', 'removed', 'owner occupier'));
    end if;
  end if;

  return jsonb_build_object(
    'ok', not v_ambiguous,
    'reason', case when v_ambiguous then 'ambiguous_property' else null end,
    'contact_id', v_contact, 'owner_id', v_owner,
    'property_count', v_props, 'tag', 'owner occupier',
    'changed', v_changed
  );
end $function$;

comment on function public.apply_ghl_tag_set(jsonb) is
  'Reconciles a GHL contact''s full tag list into the CRM over the managed vocabulary only (owner occupier / interested / not interested). Lets ONE GHL workflow drive both add and remove. Called by n8n /webhook/crm-tag-inbound.';
