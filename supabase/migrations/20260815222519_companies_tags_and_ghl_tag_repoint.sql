-- STAGE 2b (C): owner-level tags move from owners.tags to companies.tags.
--
-- 1. companies.tags text[] + backfill from owners.tags (23 tagged owners; union-merged).
-- 2. apply_ghl_tag / apply_ghl_tag_set resolve the owner via contacts.company_id +
--    properties.owner_company_id instead of owner_contacts/owners. Property-level tags
--    ('owner occupier') stay on properties.tags exactly as before. Response keys are kept
--    ('owner_id' now carries the COMPANY uuid; 'company_id' added alongside).
-- 3. push_tags_to_ghl gains a 'companies' branch (n8n payload keys unchanged:
--    source/id/label/targets/added/removed; targets entries contact_id/ghl_contact_id/phone).
--    Targets = verified, non-DNC contacts seated at the company (the companies-model analog
--    of "confirmed owner_contacts"). The 'owners' branch becomes a SILENT no-op: the
--    transition trigger below mirrors every owners.tags write onto companies.tags, whose own
--    trigger does the single webhook post — posting from both sides would double-fire n8n.
--    owners_push_tags stays in place and dies with the table.
-- 4. TEMPORARY trigger owners_tags_transition (+ function owners_tags_transition_copy):
--    copies owners.tags -> its company on every owner tag write, so the not-yet-deployed
--    app bundle (which still writes owners.tags) keeps landing tags on companies until the
--    parent session deploys. MUST BE DROPPED together with the owners table.

alter table companies add column if not exists tags text[];

with src as (
  select o.company_id, array_agg(distinct t) as tags
  from owners o
  cross join lateral unnest(o.tags) t
  where o.company_id is not null and o.tags is not null
  group by o.company_id
)
update companies c
set tags = (select array_agg(distinct x) from unnest(coalesce(c.tags, '{}') || s.tags) x)
from src s
where s.company_id = c.id;

-- ---------------------------------------------------------------------------
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
end $function$;

-- ---------------------------------------------------------------------------
create or replace function public.apply_ghl_tag_set(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
end $function$;

-- ---------------------------------------------------------------------------
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
  v_company uuid;
begin
  v_added   := array(select unnest(coalesce(new.tags, '{}')) except select unnest(coalesce(old.tags, '{}')));
  v_removed := array(select unnest(coalesce(old.tags, '{}')) except select unnest(coalesce(new.tags, '{}')));

  if cardinality(v_added) = 0 and cardinality(v_removed) = 0 then
    return new;
  end if;

  if tg_table_name = 'owners' then
    -- transition-only: owners_tags_transition mirrors this write onto companies.tags and
    -- the companies trigger posts the webhook once. Posting here too would double-fire.
    -- This branch (and the owners_push_tags trigger) dies with the owners table.
    return new;
  elsif tg_table_name = 'properties' then
    v_company := new.owner_company_id;
    v_label   := new.address;
  else  -- companies
    v_company := new.id;
    v_label   := new.name;
  end if;

  if v_company is null then
    return new;
  end if;

  select jsonb_agg(jsonb_build_object(
           'contact_id', c.id,
           'ghl_contact_id', c.ghl_contact_id,
           'phone', regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')
         ))
    into v_targets
  from contacts c
  where c.company_id = v_company
    and c.verified_at is not null
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

-- ---------------------------------------------------------------------------
drop trigger if exists companies_push_tags on companies;
create trigger companies_push_tags
after update of tags on companies
for each row execute function push_tags_to_ghl();

create or replace function public.owners_tags_transition_copy()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.company_id is not null then
    update companies set tags = new.tags
    where id = new.company_id and tags is distinct from new.tags;
  end if;
  return new;
end $function$;

drop trigger if exists owners_tags_transition on owners;
create trigger owners_tags_transition
after update of tags on owners
for each row execute function owners_tags_transition_copy();

comment on trigger owners_tags_transition on owners is
  'TEMPORARY stage-2b bridge: mirrors owners.tags writes (old app bundle) onto companies.tags until the repointed app deploys. Drop together with the owners table, along with function owners_tags_transition_copy().';
