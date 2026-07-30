-- Owner data room, part 2: the import pipeline.
--
-- Consolidates the migrations applied while building the owner data room (they were applied
-- incrementally via the Supabase MCP as the shape settled). Everything here is the FINAL state,
-- in dependency order, so a rebuild from files produces the live schema.
--   * contacts.import_addresses + loose street matching
--   * expression indexes that make address matching not a sequential scan
--   * import_terrakotta_batch v2 (supersedes the version in ...000002)
--   * contacts identity relaxation + HubSpot importer
--   * import_owner_addresses (create the properties behind the contact book)
--   * geocode read/write helpers
--   * relink_owner_contacts (rebuild the owner graph after enrichment)

-- ---------------------------------------------------------------- addresses kept from imports

alter table contacts add column if not exists import_addresses text[];

comment on column contacts.import_addresses is
  'Property/contact addresses as supplied by the source import (Terrakotta/HubSpot), verbatim. '
  'Retained for later property matching, geocoding and appraiser enrichment.';

-- Looser street key: drops the trailing street-type token so "110 Spirit Lake Rd" reconciles with
-- "110 Spirit Lake". Directionals are deliberately KEPT -- "2801 E Wilder" and "2801 W Wilder" are
-- different buildings. normalize_street is schema-qualified because index expressions are planned
-- with a restricted search_path and the inliner cannot otherwise resolve it.
create or replace function normalize_street_loose(p_addr text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      public.normalize_street(p_addr),
      '\s+(RD|ROAD|ST|STREET|AVE|AVENUE|BLVD|BOULEVARD|DR|DRIVE|CT|COURT|LN|LANE|WAY|HWY|HIGHWAY|PKWY|PARKWAY|TER|TERRACE|PL|PLACE|CIR|CIRCLE|TRL|TRAIL|LOOP|RUN)$',
      ''),
    ''
  );
$$;

comment on function normalize_street_loose(text) is
  'normalize_street with the trailing street-type token removed, for second-pass matching. '
  'Directional prefixes are kept on purpose.';

-- Address matching runs on every import row; without these each lookup scans the whole book.
create index if not exists properties_norm_street_idx
  on properties (public.normalize_street(address));
create index if not exists properties_norm_street_loose_idx
  on properties (public.normalize_street_loose(address));
create index if not exists properties_norm_street_city_idx
  on properties (public.normalize_street(address), upper(btrim(city)));

-- ---------------------------------------------------------------- contact identity

-- Most HubSpot contacts that matter (the deal-attached ones) carry an address and email but no
-- phone, so phone can no longer be mandatory. Identity is now "at least one of phone / email /
-- hubspot_id"; the phone-identity unique index is untouched, so phone-keyed matching is unchanged.
alter table contacts alter column phone drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_needs_identity') then
    alter table contacts add constraint contacts_needs_identity
      check (phone is not null or email is not null or hubspot_id is not null);
  end if;
end $$;

create or replace function strip_html(p text)
returns text
language sql
immutable
as $$
  select nullif(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(p, ''), '<(br|/p|/div|/li)[^>]*>', E'\n', 'gi'),
        '<[^>]+>', '', 'g'),
      '&nbsp;|&amp;|&lt;|&gt;|&#39;|&quot;', ' ', 'g')
  ), '');
$$;

comment on function strip_html(text) is 'Plain-text form of a HubSpot rich-text engagement body.';

-- ---------------------------------------------------------------- Terrakotta importer (v2)

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
  v_addrs        text[];
  v_city         text;
  v_hits         uuid[];
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
  n_exact        int := 0;
  n_loose        int := 0;
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
    v_lists := case when r ? 'L' then array(select jsonb_array_elements_text(r->'L'))
                    else '{}'::text[] end;
    v_addrs := case when r ? 'a' then array(select jsonb_array_elements_text(r->'a'))
                    else '{}'::text[] end;

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

    select * into v_existing from contacts where normalize_phone(phone) = v_phone limit 1;

    if v_existing.id is null then
      insert into contacts (first_name, last_name, phone, source_system, terrakotta_id,
                            campaign_lists, import_addresses, do_not_call)
      values (coalesce(v_first, 'Unknown'), v_last, v_phone, 'terrakotta', r->>'tk',
              nullif(v_lists, '{}'), nullif(v_addrs, '{}'), v_dnc)
      returning id into v_contact_id;
      n_contacts_new := n_contacts_new + 1;
    else
      v_contact_id := v_existing.id;
      update contacts c
      set first_name    = case when c.first_name in ('Unknown', '') or c.first_name is null
                               then coalesce(v_first, c.first_name) else c.first_name end,
          last_name     = coalesce(c.last_name, v_last),
          terrakotta_id = coalesce(c.terrakotta_id, r->>'tk'),
          source_system = coalesce(c.source_system, 'terrakotta'),
          campaign_lists = (
            select case when count(*) = 0 then null else array_agg(distinct x) end
            from (select unnest(coalesce(c.campaign_lists, '{}'::text[])) as x
                  union select unnest(v_lists)) u
            where x is not null),
          import_addresses = (
            select case when count(*) = 0 then null else array_agg(distinct x) end
            from (select unnest(coalesce(c.import_addresses, '{}'::text[])) as x
                  union select unnest(v_addrs)) u
            where x is not null),
          do_not_call   = c.do_not_call or v_dnc
      where c.id = v_contact_id;
      n_contacts_upd := n_contacts_upd + 1;
    end if;

    v_prop_ids := '{}';
    foreach v_addr in array v_addrs
    loop
      v_city := nullif(btrim(split_part(v_addr, ',', 2)), '');

      v_hits := coalesce((
        select array_agg(pp.id) from properties pp
        where normalize_street(pp.address) = normalize_street(v_addr)
          and (v_city is null or pp.city is null or upper(btrim(pp.city)) = upper(v_city))
      ), '{}'::uuid[]);

      if array_length(v_hits, 1) is not null then
        n_exact := n_exact + 1;
      elsif v_city is not null then
        v_hits := coalesce((
          select array_agg(pp.id) from properties pp
          where normalize_street_loose(pp.address) = normalize_street_loose(v_addr)
            and pp.city is not null and upper(btrim(pp.city)) = upper(v_city)
        ), '{}'::uuid[]);
        if array_length(v_hits, 1) is not null then
          n_loose := n_loose + 1;
        end if;
      end if;

      v_prop_ids := v_prop_ids || v_hits;
    end loop;

    v_prop_ids := coalesce((select array_agg(distinct x) from unnest(v_prop_ids) x), '{}'::uuid[]);
    if array_length(v_prop_ids, 1) is null then
      n_no_match := n_no_match + 1;
    end if;

    foreach v_prop_id in array v_prop_ids
    loop
      select owner_id into v_owner_id from properties where id = v_prop_id;
      if v_owner_id is not null then
        insert into owner_contacts (owner_id, contact_id, role, confidence, match_basis)
        values (v_owner_id, v_contact_id, 'skip_trace', 'unconfirmed', 'property_address')
        on conflict (owner_id, contact_id) do nothing;
        if found then n_links := n_links + 1; end if;
      end if;
    end loop;

    if r ? 'ev' then
      for ev in select * from jsonb_array_elements(r->'ev')
      loop
        begin
          v_occurred := to_timestamp(ev->>'c', 'Mon DD, YYYY HH12:MIAM');
        exception when others then
          v_occurred := null;
        end;

        v_tags := case when nullif(ev->>'t', '') is null then null
                       else array(select btrim(m[1])
                                  from regexp_matches(ev->>'t', '\[([^\]]+)\]', 'g') m) end;

        v_ext := coalesce(ev->>'id', v_phone) || ':' ||
                 substr(md5(coalesce(ev->>'d','') || coalesce(ev->>'t','') ||
                            coalesce(ev->>'n','') || coalesce(ev->>'x','') ||
                            coalesce(ev->>'c','')), 1, 12);

        insert into communications (contact_id, phone, owner_id, property_id, channel, direction,
                                    occurred_at, body, transcript, disposition, tags, source,
                                    external_id, raw)
        values (v_contact_id, v_phone,
                (select owner_id from properties where id = v_prop_ids[1]),
                v_prop_ids[1], 'call', 'outbound', coalesce(v_occurred, now()),
                nullif(ev->>'n', ''), nullif(ev->>'x', ''), nullif(ev->>'d', ''),
                v_tags, 'terrakotta', v_ext, ev)
        on conflict (source, external_id) do nothing;
        if found then n_comms := n_comms + 1; end if;
      end loop;
    end if;

    update contacts c
    set last_contacted_at = greatest(
          c.last_contacted_at,
          (select max(occurred_at) from communications where contact_id = v_contact_id))
    where c.id = v_contact_id;
  end loop;

  return jsonb_build_object(
    'contacts_created', n_contacts_new,
    'contacts_updated', n_contacts_upd,
    'owner_links_created', n_links,
    'communications_created', n_comms,
    'addresses_matched_exact', n_exact,
    'addresses_matched_loose', n_loose,
    'phones_with_no_property_match', n_no_match);
end $$;

-- ---------------------------------------------------------------- HubSpot importer

-- p = { "type": "contacts" | "deals" | "engagements", "rows": [...] }
create or replace function import_hubspot_batch(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type      text := p->>'type';
  r           jsonb;
  v_id        text;
  v_phone     text;
  v_email     text;
  v_first     text;
  v_last      text;
  v_company   text;
  v_addr      text;
  v_contact   uuid;
  v_owner     uuid;
  v_prop      uuid;
  v_city      text;
  v_chan      comm_channel;
  v_occ       timestamptz;
  v_body      text;
  v_subj      text;
  cid         text;
  n_new       int := 0;
  n_upd       int := 0;
  n_link      int := 0;
  n_conf      int := 0;
  n_comm      int := 0;
  n_skip      int := 0;
begin
  if v_type = 'contacts' then
    for r in select * from jsonb_array_elements(p->'rows')
    loop
      v_id    := r->>'id';
      v_phone := normalize_phone(coalesce(nullif(r#>>'{p,phone}', ''), r#>>'{p,mobilephone}'));
      v_email := nullif(btrim(coalesce(r#>>'{p,email}', '')), '');
      v_first := nullif(btrim(coalesce(r#>>'{p,firstname}', '')), '');
      v_last  := nullif(btrim(coalesce(r#>>'{p,lastname}', '')), '');
      v_company := nullif(btrim(coalesce(r#>>'{p,company}', '')), '');
      v_addr  := nullif(btrim(coalesce(r#>>'{p,address}', '')), '');
      v_city  := nullif(btrim(coalesce(r#>>'{p,city}', '')), '');

      if v_phone is null and v_email is null and v_id is null then
        n_skip := n_skip + 1;
        continue;
      end if;

      select id into v_contact from contacts where hubspot_id = v_id limit 1;
      if v_contact is null and v_phone is not null then
        select id into v_contact from contacts where normalize_phone(phone) = v_phone limit 1;
      end if;

      if v_contact is null then
        insert into contacts (first_name, last_name, phone, email, hubspot_id, source_system,
                              import_addresses, title)
        values (coalesce(v_first, v_company, 'Unknown'), v_last, v_phone, v_email, v_id,
                'hubspot',
                case when v_addr is null then null
                     else array[v_addr || coalesce(', ' || v_city, '')] end,
                nullif(btrim(coalesce(r#>>'{p,jobtitle}', '')), ''))
        returning id into v_contact;
        n_new := n_new + 1;
      else
        -- HubSpot is the system of record: its non-null values win
        update contacts c
        set first_name       = coalesce(v_first, c.first_name),
            last_name        = coalesce(v_last, c.last_name),
            email            = coalesce(v_email, c.email),
            phone            = coalesce(c.phone, v_phone),
            hubspot_id       = coalesce(c.hubspot_id, v_id),
            title            = coalesce(nullif(btrim(coalesce(r#>>'{p,jobtitle}', '')), ''), c.title),
            source_system    = 'hubspot',
            import_addresses = (
              select case when count(*) = 0 then null else array_agg(distinct x) end
              from (select unnest(coalesce(c.import_addresses, '{}'::text[])) as x
                    union select v_addr || coalesce(', ' || v_city, '')) u
              where x is not null)
        where c.id = v_contact;
        n_upd := n_upd + 1;
      end if;

      -- a contact whose company name IS an owner entity is a strong (not proven) owner link
      if v_company is not null then
        select id into v_owner from owners
        where normalized_name = normalize_owner_name(v_company) limit 1;
        if v_owner is not null then
          insert into owner_contacts (owner_id, contact_id, role, confidence, match_basis)
          values (v_owner, v_contact, 'company_match', 'likely', 'company_name')
          on conflict (owner_id, contact_id) do update
            set confidence = case when owner_contacts.confidence = 'unconfirmed'
                                  then 'likely' else owner_contacts.confidence end,
                match_basis = coalesce(owner_contacts.match_basis, 'company_name');
          n_link := n_link + 1;
        end if;
      end if;

      if v_addr is not null then
        select pp.id, pp.owner_id into v_prop, v_owner
        from properties pp
        where normalize_street(pp.address) = normalize_street(v_addr)
          and (v_city is null or pp.city is null or upper(btrim(pp.city)) = upper(v_city))
        limit 1;
        if v_owner is not null then
          insert into owner_contacts (owner_id, contact_id, role, confidence, match_basis)
          values (v_owner, v_contact, 'property_match', 'likely', 'property_address')
          on conflict (owner_id, contact_id) do nothing;
          n_link := n_link + 1;
        end if;
      end if;
    end loop;

  elsif v_type = 'deals' then
    -- A contact attached to a deal is a VERIFIED owner contact (Alex's rule).
    for r in select * from jsonb_array_elements(p->'rows')
    loop
      for cid in select jsonb_array_elements_text(coalesce(r->'c', '[]'::jsonb))
      loop
        select id into v_contact from contacts where hubspot_id = cid limit 1;
        continue when v_contact is null;
        update owner_contacts
        set confidence  = 'confirmed',
            verified_at = coalesce(verified_at, now()),
            verified_by = coalesce(verified_by, 'hubspot_deal'),
            match_basis = 'hubspot_deal'
        where contact_id = v_contact and confidence <> 'confirmed';
        if found then n_conf := n_conf + 1; end if;
      end loop;
    end loop;

  elsif v_type = 'engagements' then
    for r in select * from jsonb_array_elements(p->'rows')
    loop
      v_chan := (r->>'k')::comm_channel;
      v_occ  := coalesce(
                  nullif(r#>>'{p,hs_timestamp}', '')::timestamptz,
                  nullif(r#>>'{p,hs_createdate}', '')::timestamptz);
      continue when v_occ is null;

      v_body := strip_html(coalesce(r#>>'{p,hs_call_body}', r#>>'{p,hs_note_body}',
                                    r#>>'{p,hs_meeting_body}'));
      v_subj := coalesce(nullif(r#>>'{p,hs_call_title}', ''),
                         nullif(r#>>'{p,hs_meeting_title}', ''));

      for cid in select jsonb_array_elements_text(coalesce(r->'c', '[]'::jsonb))
      loop
        select id into v_contact from contacts where hubspot_id = cid limit 1;
        continue when v_contact is null;

        insert into communications (contact_id, phone, owner_id, channel, direction, occurred_at,
                                    subject, body, disposition, source, external_id, raw)
        values (v_contact,
                (select normalize_phone(phone) from contacts where id = v_contact),
                (select owner_id from owner_contacts where contact_id = v_contact
                 order by case confidence when 'confirmed' then 0 when 'likely' then 1 else 2 end
                 limit 1),
                v_chan,
                case lower(coalesce(r#>>'{p,hs_call_direction}', ''))
                  when 'inbound' then 'inbound'::comm_direction
                  when 'outbound' then 'outbound'::comm_direction
                  else 'unknown'::comm_direction end,
                v_occ, v_subj, v_body,
                nullif(r#>>'{p,hs_call_disposition}', ''),
                'hubspot', (r->>'k') || ':' || (r->>'id') || ':' || cid, r)
        on conflict (source, external_id) do nothing;
        if found then n_comm := n_comm + 1; end if;
      end loop;
    end loop;
  else
    return jsonb_build_object('error', 'unknown type: ' || coalesce(v_type, '(null)'));
  end if;

  return jsonb_build_object(
    'type', v_type, 'created', n_new, 'updated', n_upd, 'owner_links', n_link,
    'confirmed_links', n_conf, 'communications', n_comm, 'skipped', n_skip);
end $$;

-- ---------------------------------------------------------------- create properties from addresses

-- These buildings were never listed, so they are created listing_status='off_market' -- calling
-- them on_market would inflate every county median and hand the sweep's off-market finalizer a
-- few thousand rows it has never seen. source='owner_import' keeps them separable and reversible.
create or replace function import_owner_addresses(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r         jsonb;
  v_addr    text;
  v_city    text;
  v_state   text;
  v_zip     text;
  v_key     text;
  v_exists  uuid;
  n_new     int := 0;
  n_dupe    int := 0;
  n_bad     int := 0;
begin
  for r in select * from jsonb_array_elements(p->'rows')
  loop
    v_addr  := nullif(btrim(coalesce(r->>'a', '')), '');
    v_city  := nullif(btrim(coalesce(r->>'c', '')), '');
    v_state := nullif(btrim(coalesce(r->>'s', '')), '');
    v_zip   := nullif(btrim(coalesce(r->>'z', '')), '');

    -- a street address without a leading house number is a cross-street or a PO box, not a parcel
    if v_addr is null or v_addr !~ '^\s*\d' then
      n_bad := n_bad + 1;
      continue;
    end if;

    select id into v_exists from properties
    where normalize_street(address) = normalize_street(v_addr)
      and (v_city is null or city is null or upper(btrim(city)) = upper(v_city))
    limit 1;

    if v_exists is null and v_city is not null then
      select id into v_exists from properties
      where normalize_street_loose(address) = normalize_street_loose(v_addr)
        and city is not null and upper(btrim(city)) = upper(v_city)
      limit 1;
    end if;

    if v_exists is not null then
      n_dupe := n_dupe + 1;
      continue;
    end if;

    v_key := 'addr:' || substr(md5(normalize_street(v_addr) || '|' || upper(coalesce(v_city, ''))), 1, 20);

    insert into properties (address, city, state, zip, source, source_key, listing_status)
    values (v_addr, v_city,
            case when upper(coalesce(v_state, '')) in ('FLORIDA', 'FL') then 'FL' else v_state end,
            v_zip, 'owner_import', v_key, 'off_market')
    on conflict do nothing;
    if found then n_new := n_new + 1; else n_dupe := n_dupe + 1; end if;
  end loop;

  return jsonb_build_object('created', n_new, 'already_present', n_dupe, 'rejected_no_number', n_bad);
end $$;

-- ---------------------------------------------------------------- geocode helpers

-- The batch geocoder runs out of band, so it needs to pull pending rows and push coordinates back.
create or replace function pending_geocode(p jsonb default '{}'::jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'a', address, 'c', city, 's', state, 'z', zip)), '[]'::jsonb)
  from (
    select id, address, city, state, zip
    from properties
    where lat is null
      and address is not null
      and address ~ '^\s*\d'
      and address not ilike '%unavailable%'
      and address not ilike 'Portfolio of %'
    order by created_at desc
    limit coalesce((p->>'limit')::int, 500)
  ) t;
$$;

create or replace function set_property_coords(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare n int := 0;
begin
  update properties pr
  set lat = (r->>'lat')::numeric,
      lng = (r->>'lng')::numeric
  from jsonb_array_elements(p->'rows') r
  where pr.id = (r->>'id')::uuid
    and pr.lat is null
    and (r->>'lat') is not null;
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n);
end $$;

-- ---------------------------------------------------------------- rebuild the owner graph

-- Re-derive owners after county enrichment supplies owner_name on newly created properties.
-- Idempotent and chunkable. Confidence ladder: terrakotta skip-trace numbers land 'unconfirmed'
-- (a phone tied to a parcel is evidence of nothing); HubSpot CRM records land 'likely';
-- 'confirmed' is set only by the deal-attached pass in import_hubspot_batch.
create or replace function relink_owner_contacts(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_owners_new int := 0;
  n_props      int := 0;
  n_links      int := 0;
  v_limit      int := coalesce((p->>'contact_limit')::int, 3000);
  v_offset     int := coalesce((p->>'contact_offset')::int, 0);
  c            record;
  v_addr       text;
  v_city       text;
  v_owner      uuid;
  v_conf       owner_contact_confidence;
begin
  with src as (
    select normalize_owner_name(owner_name) as nn,
           btrim(owner_name) as raw,
           btrim(owner_mailing_address) as mail
    from properties
    where owner_name is not null and btrim(owner_name) <> ''
  ),
  missing as (
    select nn from src
    group by nn
    having nn not in (select normalized_name from owners where normalized_name is not null)
  ),
  name_pick as (
    select s.nn, s.raw,
           row_number() over (partition by s.nn order by count(*) desc, length(s.raw) desc, s.raw) rn
    from src s join missing m on m.nn = s.nn
    group by s.nn, s.raw
  ),
  mail_pick as (
    select s.nn, s.mail,
           row_number() over (partition by s.nn order by count(*) desc, length(s.mail) desc, s.mail) rn
    from src s join missing m on m.nn = s.nn
    where s.mail is not null and s.mail <> ''
    group by s.nn, s.mail
  )
  insert into owners (display_name, mailing_address, kind)
  select n.raw, mp.mail,
    case
      when n.nn ~ '(\mCOUNTY\M|CITY OF|STATE OF|\mSCHOOL\M|AUTHORITY|MUNICIPAL|TOWN OF|UNITED STATES|\mDEPT\M|DEPARTMENT|\mUSA\M)' then 'government'
      when n.nn ~ '(\mLLC\M|\mINC\M|\mCORP\M|\mLP\M|\mLLP\M|\mLLLP\M|\mPLLC\M|\mLTD\M|\mTRUST\M|\mTR\M|HOLDINGS|PROPERTIES|PARTNERSHIP|\mCO\M|ASSOC|\mBANK\M|\mGROUP\M|ENTERPRISES|INVESTMENTS|\mREIT\M|\mFLP\M|\mPA\M|\mLC\M)' then 'entity'
      else 'individual'
    end::owner_kind
  from name_pick n
  left join mail_pick mp on mp.nn = n.nn and mp.rn = 1
  where n.rn = 1
  on conflict (normalized_name) do nothing;
  get diagnostics n_owners_new = row_count;

  update properties pr
  set owner_id = o.id
  from owners o
  where o.normalized_name = normalize_owner_name(pr.owner_name)
    and pr.owner_name is not null
    and pr.owner_id is distinct from o.id;
  get diagnostics n_props = row_count;

  for c in
    select id, source_system, import_addresses
    from contacts
    where import_addresses is not null
    order by id
    limit v_limit offset v_offset
  loop
    v_conf := case when c.source_system = 'hubspot' then 'likely'::owner_contact_confidence
                   else 'unconfirmed'::owner_contact_confidence end;

    foreach v_addr in array c.import_addresses
    loop
      v_city := nullif(btrim(split_part(v_addr, ',', 2)), '');

      select pp.owner_id into v_owner
      from properties pp
      where normalize_street(pp.address) = normalize_street(v_addr)
        and pp.owner_id is not null
        and (v_city is null or pp.city is null or upper(btrim(pp.city)) = upper(v_city))
      limit 1;

      if v_owner is null and v_city is not null then
        select pp.owner_id into v_owner
        from properties pp
        where normalize_street_loose(pp.address) = normalize_street_loose(v_addr)
          and pp.owner_id is not null
          and pp.city is not null and upper(btrim(pp.city)) = upper(v_city)
        limit 1;
      end if;

      if v_owner is not null then
        insert into owner_contacts (owner_id, contact_id, role, confidence, match_basis)
        values (v_owner, c.id, 'address_match', v_conf, 'property_address')
        on conflict (owner_id, contact_id) do nothing;
        if found then n_links := n_links + 1; end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'owners_created', n_owners_new,
    'properties_relinked', n_props,
    'owner_links_created', n_links,
    'contacts_scanned_from', v_offset,
    'contacts_scanned_limit', v_limit);
end $$;

-- ---------------------------------------------------------------- grants

revoke all on function import_terrakotta_batch(jsonb) from public, anon;
revoke all on function import_hubspot_batch(jsonb)   from public, anon;
revoke all on function import_owner_addresses(jsonb) from public, anon;
revoke all on function pending_geocode(jsonb)        from public, anon;
revoke all on function set_property_coords(jsonb)    from public, anon;
revoke all on function relink_owner_contacts(jsonb)  from public, anon;

grant execute on function import_terrakotta_batch(jsonb) to service_role, authenticated;
grant execute on function import_hubspot_batch(jsonb)    to service_role, authenticated;
grant execute on function import_owner_addresses(jsonb)  to service_role, authenticated;
grant execute on function pending_geocode(jsonb)         to service_role, authenticated;
grant execute on function set_property_coords(jsonb)     to service_role, authenticated;
grant execute on function relink_owner_contacts(jsonb)   to service_role, authenticated;
