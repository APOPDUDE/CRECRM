-- Terrakotta phone-book import.
--
-- Payload is the collapsed CSV export: one record per phone.
--   [{ "p": "8135551234",            -- normalized 10-digit phone (identity)
--      "f": "Robert", "l": "Noell",  -- names (may be absent)
--      "tk": "1fbd35e8",             -- terrakotta id
--      "a": ["1227 S Lincoln Ave, Clearwater, Florida, 33756-4259"],   -- property addresses
--      "L": ["Clearwater + Safety Harbor - Rob"],                      -- campaign lists
--      "ev": [{"d":disposition,"t":tags,"n":notes,"x":transcript,"c":"Nov 07, 2025 06:45PM","id":tkid}]
--   }]
--
-- Rules:
--  * HubSpot is the system of record for duplicates, so an EXISTING contact only ever gets
--    blank fields filled in — never overwritten. Campaign lists are merged, not replaced.
--  * Address -> property matching requires the city to agree when both sides have one; street
--    names repeat across Tampa Bay cities ("316 Commerce Ct" exists in more than one), and a
--    wrong property link would attach a conversation to a stranger's building.
--  * A skip-traced number is evidence of nothing, so owner_contacts lands as 'unconfirmed'.
--    'confirmed' is reserved for actual spoken confirmation (HubSpot calls / manual review).

-- Street-only comparison key: drop the unit/city/state/zip tail, upper, de-punctuate, collapse.
create or replace function normalize_street(p_addr text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(upper(split_part(coalesce(p_addr, ''), ',', 1)), '[.,#]', '', 'g'),
        '\s+', ' ', 'g'),
      '^\s+|\s+$', '', 'g'),
    ''
  );
$$;

comment on function normalize_street(text) is
  'Street-portion dedupe key (text before the first comma), upper/de-punctuated/collapsed.';

create or replace function import_terrakotta_batch(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r              jsonb;
  ev             jsonb;
  v_phone        text;
  v_contact_id   uuid;
  v_existing     contacts;
  v_first        text;
  v_last         text;
  v_lists        text[];
  v_addr         text;
  v_city         text;
  v_prop_ids     uuid[];
  v_prop_id      uuid;
  v_owner_id     uuid;
  v_dnc          boolean;
  v_occurred     timestamptz;
  v_tags         text[];
  v_ext          text;
  n_contacts_new int := 0;
  n_contacts_upd int := 0;
  n_links        int := 0;
  n_comms        int := 0;
  n_prop_matched int := 0;
  n_no_match     int := 0;
begin
  for r in select * from jsonb_array_elements(p)
  loop
    v_phone := r->>'p';
    if v_phone is null or length(v_phone) <> 10 then
      continue;
    end if;

    v_first := nullif(btrim(coalesce(r->>'f', '')), '');
    v_last  := nullif(btrim(coalesce(r->>'l', '')), '');
    v_lists := case
                 when r ? 'L' then array(select jsonb_array_elements_text(r->'L'))
                 else '{}'::text[]
               end;

    -- does this number carry a do-not-call signal anywhere in its events?
    v_dnc := false;
    if r ? 'ev' then
      for ev in select * from jsonb_array_elements(r->'ev')
      loop
        if coalesce(ev->>'d', '') ilike '%do not call%'
           or coalesce(ev->>'t', '') ilike '%do not call%' then
          v_dnc := true;
        end if;
      end loop;
    end if;

    -- ---------------- contact (phone identity) ----------------
    select * into v_existing
    from contacts
    where normalize_phone(phone) = v_phone
    limit 1;

    if v_existing.id is null then
      insert into contacts (first_name, last_name, phone, source_system, terrakotta_id,
                            campaign_lists, do_not_call)
      values (coalesce(v_first, 'Unknown'), v_last, v_phone, 'terrakotta', r->>'tk',
              nullif(v_lists, '{}'), v_dnc)
      returning id into v_contact_id;
      n_contacts_new := n_contacts_new + 1;
    else
      v_contact_id := v_existing.id;
      -- fill blanks only; merge list membership; DNC is sticky (never un-set here)
      update contacts c
      set first_name    = case when c.first_name in ('Unknown', '') or c.first_name is null
                               then coalesce(v_first, c.first_name) else c.first_name end,
          last_name     = coalesce(c.last_name, v_last),
          terrakotta_id = coalesce(c.terrakotta_id, r->>'tk'),
          source_system = coalesce(c.source_system, 'terrakotta'),
          campaign_lists = (
            select case when count(*) = 0 then null else array_agg(distinct x) end
            from (
              select unnest(coalesce(c.campaign_lists, '{}'::text[])) as x
              union
              select unnest(v_lists)
            ) u
            where x is not null
          ),
          do_not_call   = c.do_not_call or v_dnc
      where c.id = v_contact_id;
      n_contacts_upd := n_contacts_upd + 1;
    end if;

    -- ---------------- property matching ----------------
    v_prop_ids := '{}';
    if r ? 'a' then
      for v_addr in select jsonb_array_elements_text(r->'a')
      loop
        -- second comma-separated field is the city in every observed row
        v_city := nullif(btrim(split_part(v_addr, ',', 2)), '');
        v_prop_ids := v_prop_ids || coalesce((
          select array_agg(pp.id)
          from properties pp
          where normalize_street(pp.address) = normalize_street(v_addr)
            and (
              v_city is null or pp.city is null
              or upper(btrim(pp.city)) = upper(v_city)
            )
        ), '{}'::uuid[]);
      end loop;
    end if;

    v_prop_ids := coalesce(
      (select array_agg(distinct x) from unnest(v_prop_ids) x), '{}'::uuid[]
    );
    if array_length(v_prop_ids, 1) is null then
      n_no_match := n_no_match + 1;
    else
      n_prop_matched := n_prop_matched + 1;
    end if;

    -- ---------------- owner links ----------------
    foreach v_prop_id in array v_prop_ids
    loop
      select owner_id into v_owner_id from properties where id = v_prop_id;
      if v_owner_id is not null then
        insert into owner_contacts (owner_id, contact_id, role, confidence, match_basis)
        values (v_owner_id, v_contact_id, 'skip_trace', 'unconfirmed', 'property_address')
        on conflict (owner_id, contact_id) do nothing;
        if found then
          n_links := n_links + 1;
        end if;
      end if;
    end loop;

    -- ---------------- conversations ----------------
    if r ? 'ev' then
      for ev in select * from jsonb_array_elements(r->'ev')
      loop
        begin
          v_occurred := to_timestamp(ev->>'c', 'Mon DD, YYYY HH12:MIAM');
        exception when others then
          v_occurred := null;
        end;

        -- tags arrive as "[Cold] [Not interested]"
        v_tags := case
                    when nullif(ev->>'t', '') is null then null
                    else array(
                      select btrim(m[1])
                      from regexp_matches(ev->>'t', '\[([^\]]+)\]', 'g') m
                    )
                  end;

        v_ext := coalesce(ev->>'id', v_phone) || ':' ||
                 substr(md5(coalesce(ev->>'d','') || coalesce(ev->>'t','') ||
                            coalesce(ev->>'n','') || coalesce(ev->>'x','') ||
                            coalesce(ev->>'c','')), 1, 12);

        insert into communications (contact_id, phone, owner_id, property_id, channel, direction,
                                    occurred_at, body, transcript, disposition, tags, source,
                                    external_id, raw)
        values (v_contact_id, v_phone,
                (select owner_id from properties where id = v_prop_ids[1]),
                v_prop_ids[1],
                'call', 'outbound',
                coalesce(v_occurred, now()),
                nullif(ev->>'n', ''), nullif(ev->>'x', ''), nullif(ev->>'d', ''),
                v_tags, 'terrakotta', v_ext, ev)
        on conflict (source, external_id) do nothing;
        if found then
          n_comms := n_comms + 1;
        end if;
      end loop;
    end if;

    -- keep last_contacted_at honest
    update contacts c
    set last_contacted_at = greatest(
          c.last_contacted_at,
          (select max(occurred_at) from communications where contact_id = v_contact_id)
        )
    where c.id = v_contact_id;
  end loop;

  return jsonb_build_object(
    'contacts_created', n_contacts_new,
    'contacts_updated', n_contacts_upd,
    'owner_links_created', n_links,
    'communications_created', n_comms,
    'phones_matched_to_property', n_prop_matched,
    'phones_with_no_property_match', n_no_match
  );
end $$;

revoke all on function import_terrakotta_batch(jsonb) from public, anon;
grant execute on function import_terrakotta_batch(jsonb) to service_role, authenticated;

comment on function import_terrakotta_batch(jsonb) is
  'Idempotent Terrakotta phone-book import. Existing contacts get blanks filled only (HubSpot '
  'wins); (source, external_id) dedupes conversations; owner links land unconfirmed.';
