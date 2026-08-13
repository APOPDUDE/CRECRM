-- Outbound half of the two-way tag sync: a tag added or removed in the CRE CRM is
-- pushed onto the owner's GHL contact.
--
-- Loop safety is structural, not a marker. Tags are a SET on both sides: re-adding an
-- existing tag returns `tagsAdded: []` from GHL and fires no event, and the triggers
-- below only fire when the array actually CHANGES. So a tag arriving from GHL is
-- written once here, pushed back once, and dies there. That is why this needs no
-- equivalent of the note sync's `[via CRE CRM]` echo guard.
--
-- Which GHL contact: properties -> owner -> CONFIRMED owner_contacts -> contacts.
-- Confirmed only, on purpose. A 'likely' link is a guess, and GHL holds one contact per
-- skip-traced phone (Angela Miller is four rows there), so pushing on a guess would tag
-- the wrong one of a person's own duplicates.

create or replace function public.push_tags_to_ghl()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_added   text[];
  v_removed text[];
  v_targets jsonb;
  v_label   text;
  v_owner   uuid;
begin
  v_added   := array(select unnest(coalesce(new.tags, '{}')) except select unnest(coalesce(old.tags, '{}')));
  v_removed := array(select unnest(coalesce(old.tags, '{}')) except select unnest(coalesce(new.tags, '{}')));

  -- Nothing actually changed (a same-value write, or another column's update).
  if cardinality(v_added) = 0 and cardinality(v_removed) = 0 then
    return new;
  end if;

  if tg_table_name = 'properties' then
    v_owner := new.owner_id;
    v_label := new.address;
  else
    v_owner := new.id;
    v_label := new.display_name;
  end if;

  if v_owner is null then
    return new;
  end if;

  select jsonb_agg(jsonb_build_object(
           'contact_id', c.id,
           'ghl_contact_id', c.ghl_contact_id,
           'phone', regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')
         ))
    into v_targets
  from owner_contacts oc
  join contacts c on c.id = oc.contact_id
  where oc.owner_id = v_owner
    and oc.confidence = 'confirmed'
    and not c.do_not_call;

  if v_targets is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://n8n.ayxco.com/webhook/crm-tag-push',
    body := jsonb_build_object(
      'source',  tg_table_name,
      'id',      new.id,
      'label',   v_label,
      'targets', v_targets,
      'added',   to_jsonb(v_added),
      'removed', to_jsonb(v_removed)
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  return new;
end $function$;

comment on function public.push_tags_to_ghl() is
  'Pushes CRE CRM tag changes onto the owner''s confirmed GHL contacts (n8n /webhook/crm-tag-push).';

-- `of tags` matters: without it every property UPDATE (enrichment, geocoding, the nightly
-- sweep) would evaluate the function, and the appraiser backfill alone touches thousands
-- of rows a night.
drop trigger if exists properties_push_tags on properties;
create trigger properties_push_tags
  after update of tags on properties
  for each row execute function push_tags_to_ghl();

drop trigger if exists owners_push_tags on owners;
create trigger owners_push_tags
  after update of tags on owners
  for each row execute function push_tags_to_ghl();
