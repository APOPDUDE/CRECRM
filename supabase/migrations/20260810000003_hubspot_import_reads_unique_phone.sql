-- HubSpot import: read the phone number from where this portal actually keeps it.
--
-- import_hubspot_batch read {p,phone} then {p,mobilephone}. Both are empty on
-- almost every contact in this portal — the number lives in the custom
-- **unique_phone_number** property. The result: 5,195 HubSpot contacts had a
-- number and only ~1,275 CRM rows did. The 2026-08-10 cleanup backfilled the
-- gap by hand; without this fix the next sync recreates it.
--
-- Second fix: normalize_phone() returns NULL for anything with an extension
-- ("+1 941-924-8346 ext. 25" -> NULL), silently dropping those numbers. Strip a
-- trailing ext/x suffix before normalizing.
--
-- Only the v_phone assignment changes; the rest of the function is unchanged.

create or replace function public.import_hubspot_batch(p jsonb)
returns jsonb
language plpgsql
security definer
as $fn$
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
      -- unique_phone_number FIRST: it is where this portal stores numbers.
      -- Strip a trailing extension, which would otherwise normalize to NULL.
      v_phone := normalize_phone(
                   regexp_replace(
                     coalesce(nullif(btrim(coalesce(r#>>'{p,unique_phone_number}', '')), ''),
                              nullif(btrim(coalesce(r#>>'{p,phone}', '')), ''),
                              nullif(btrim(coalesce(r#>>'{p,mobilephone}', '')), '')),
                     '\s*(?:ext|x)\.?\s*[0-9]+\s*$', '', 'i'));
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

      -- identity: hubspot id, else phone
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

      -- address -> property -> owner
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
    -- Alex's rule: a contact attached to a deal is a VERIFIED owner contact.
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
end
$fn$;
