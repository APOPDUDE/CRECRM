-- Owner email-campaign leads: the person, their verified-or-not email, and the link
-- to the property they were mailed about.
--
-- These lists were built FROM ownership records -- each row is "the owner of <address>"
-- with the email the campaign used. So beyond the contact itself, the row carries an
-- owner_contacts link: match the address to a property, the property to its owner, and
-- attach the person.
--
-- Confidence, not verification. A reply about selling THIS building ("interested" /
-- "not interested") is strong evidence the person really is its owner, so those links
-- land as confirmed; everyone else is likely. verified_at is NEVER set here: that
-- column means "spoke to them on the phone", it feeds the map's verified-owner filter,
-- and an email reply is not a phone conversation. The email's own deliverability goes
-- where it belongs -- contacts.email_verified_at.
--
-- Same identity rules as every import before it: fill only nulls, one contact per
-- normalized phone (a taken number stays where it is), and a person with no reachable
-- identity at all is not inserted.

-- Email lookups happen once per imported row; contacts had no index on the folded email.
create index if not exists contacts_email_lower_idx on contacts (lower(btrim(email))) where email is not null;

create or replace function import_owner_email_leads(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r jsonb;
  v_ct uuid; v_phone text; v_email text;
  v_prop uuid; v_owner uuid; v_conf owner_contact_confidence;
  n_in int := 0; n_ct_new int := 0; n_ct_upd int := 0; n_verified int := 0;
  n_phone_dropped int := 0; n_no_identity int := 0;
  n_prop_matched int := 0; n_owner_linked int := 0; n_no_prop int := 0; n_no_owner int := 0;
begin
  for r in select * from jsonb_array_elements(p) loop
    n_in := n_in + 1;
    v_email := nullif(btrim(coalesce(r->>'email', '')), '');

    -- personal phone only if free, or already on this same person (matched below)
    v_phone := nullif(btrim(coalesce(r->>'phone', '')), '');

    -- the person: email match anywhere, else same-name-same-phone
    v_ct := null;
    if v_email is not null then
      select id into v_ct from contacts
      where lower(btrim(email)) = lower(btrim(v_email)) limit 1;
    end if;
    if v_ct is null and v_phone is not null then
      select id into v_ct from contacts
      where normalize_phone(phone) = normalize_phone(v_phone)
        and lower(btrim(first_name)) = lower(btrim(r->>'first'))
      limit 1;
    end if;

    if v_ct is null and v_phone is not null and exists (
      select 1 from contacts c2 where normalize_phone(c2.phone) = normalize_phone(v_phone)
    ) then
      v_phone := null;  -- number belongs to someone else already
      n_phone_dropped := n_phone_dropped + 1;
    end if;

    if v_ct is not null then
      update contacts set
        email = coalesce(email, v_email),
        phone = coalesce(phone, v_phone),
        email_verified_at = case
          when (r->>'email_verified')::boolean
           and lower(btrim(coalesce(email, v_email))) = lower(btrim(v_email))
          then coalesce(email_verified_at, now()) else email_verified_at end,
        -- append the campaign note ONCE: a resumed or repeated run must not stack copies
        notes = case
          when nullif(btrim(coalesce(r->>'note','')), '') is null then notes
          when notes is not null and position(btrim(r->>'note') in notes) > 0 then notes
          else coalesce(notes || E'\n', '') || btrim(r->>'note') end
      where id = v_ct;
      n_ct_upd := n_ct_upd + 1;
    else
      if v_phone is null and v_email is null then
        n_no_identity := n_no_identity + 1;
        continue;
      end if;
      insert into contacts (first_name, last_name, email, phone,
                            email_verified_at, notes, source_system)
      values (btrim(r->>'first'), nullif(btrim(coalesce(r->>'last','')), ''),
              v_email, v_phone,
              case when (r->>'email_verified')::boolean then now() else null end,
              nullif(btrim(coalesce(r->>'note','')), ''),
              'email_campaign')
      returning id into v_ct;
      n_ct_new := n_ct_new + 1;
    end if;
    if (r->>'email_verified')::boolean then n_verified := n_verified + 1; end if;

    -- the property they were mailed about -> its owner -> the link
    if nullif(btrim(coalesce(r->>'street', '')), '') is null then continue; end if;
    select id, owner_id into v_prop, v_owner from properties
    where normalize_street(address) = normalize_street(r->>'street')
      and (nullif(r->>'city', '') is null or city is null
           or upper(btrim(city)) = upper(btrim(r->>'city')))
    limit 1;
    if v_prop is null then n_no_prop := n_no_prop + 1; continue; end if;
    n_prop_matched := n_prop_matched + 1;
    if v_owner is null then n_no_owner := n_no_owner + 1; continue; end if;

    -- a reply about the building is evidence of ownership; silence is only likely
    v_conf := case when (r->>'replied')::boolean then 'confirmed' else 'likely' end;
    insert into owner_contacts (owner_id, contact_id, confidence, match_basis)
    values (v_owner, v_ct, v_conf, 'email_campaign:' || coalesce(r->>'list', '?'))
    on conflict (owner_id, contact_id) do update
      -- an existing link only ever moves UP in confidence, and verified_at is untouched
      set confidence = case
        when owner_contacts.confidence = 'confirmed' then owner_contacts.confidence
        when excluded.confidence = 'confirmed' then excluded.confidence
        when owner_contacts.confidence = 'likely' then owner_contacts.confidence
        else excluded.confidence end;
    n_owner_linked := n_owner_linked + 1;
  end loop;
  return jsonb_build_object('ok', true, 'received', n_in,
    'contacts_created', n_ct_new, 'contacts_updated', n_ct_upd,
    'emails_verified', n_verified, 'phones_left_where_they_were', n_phone_dropped,
    'skipped_no_identity', n_no_identity, 'properties_matched', n_prop_matched,
    'no_property_match', n_no_prop, 'property_has_no_owner', n_no_owner,
    'owner_links', n_owner_linked);
end $$;
