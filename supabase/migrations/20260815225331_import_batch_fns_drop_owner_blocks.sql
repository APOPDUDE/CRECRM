-- STAGE 2b end-game (2f): the two bulk-pipe keepers lose their owners/owner_contacts
-- blocks; everything else is preserved byte-for-byte via anchored replaces.
--
-- import_terrakotta_batch:
--   * the unconfirmed skip-trace link block is REMOVED (a guess must not seat
--     contacts.company_id; 'owner_links_created' stays 0 in the report),
--   * the communications insert writes owner_company_id (owner_id is being dropped),
--   * the import_terrakotta_evidence_upgrade call is removed (function retired).
-- import_hubspot_batch:
--   * both 'likely' link blocks (company-name match, property-address match) REMOVED,
--   * the deals branch keeps its loop shape but its owner_contacts confirmation is a
--     documented no-op (a HubSpot deal is provenance, not human verification — R1),
--   * the engagements communications insert writes owner_company_id sourced from the
--     contact's seat instead of the best owner_contacts link.

do $do$
declare
  src text := pg_get_functiondef('public.import_terrakotta_batch(jsonb)'::regprocedure);
  a1 text := $a$    foreach v_prop_id in array v_prop_ids
    loop
      select owner_id into v_owner_id from properties where id = v_prop_id;
      if v_owner_id is not null then
        insert into owner_contacts (owner_id, contact_id, role, confidence, match_basis)
        values (v_owner_id, v_contact_id, 'skip_trace', 'unconfirmed', 'property_address')
        on conflict (owner_id, contact_id) do nothing;
        if found then n_links := n_links + 1; end if;
      end if;
    end loop;$a$;
  r1 text := $a$    -- owners-era skip-trace links retired (stage 2b): an unconfirmed address match is
    -- a guess and must not seat contacts.company_id; owner_links_created stays 0.$a$;
  a2 text := $a$        insert into communications (contact_id, phone, owner_id, property_id, channel, direction,$a$;
  r2 text := $a$        insert into communications (contact_id, phone, owner_company_id, property_id, channel, direction,$a$;
  a3 text := $a$                (select owner_id from properties where id = v_prop_ids[1]),$a$;
  r3 text := $a$                (select owner_company_id from properties where id = v_prop_ids[1]),$a$;
  a4 text := $a$      -- Alex's rule: real engagement (tag / notes / connected call) verifies; silence doesn't
      perform import_terrakotta_evidence_upgrade(v_contact_id);$a$;
  r4 text := $a$      -- import_terrakotta_evidence_upgrade retired with owner_contacts (stage 2b).$a$;
begin
  if (length(src) - length(replace(src, a1, ''))) / length(a1) <> 1 then
    raise exception 'import_terrakotta_batch: link-block anchor not found exactly once';
  end if;
  if (length(src) - length(replace(src, a2, ''))) / length(a2) <> 1 then
    raise exception 'import_terrakotta_batch: comm-insert anchor not found exactly once';
  end if;
  if (length(src) - length(replace(src, a3, ''))) / length(a3) <> 1 then
    raise exception 'import_terrakotta_batch: owner-subselect anchor not found exactly once';
  end if;
  if (length(src) - length(replace(src, a4, ''))) / length(a4) <> 1 then
    raise exception 'import_terrakotta_batch: evidence-upgrade anchor not found exactly once';
  end if;
  src := replace(src, a1, r1);
  src := replace(src, a2, r2);
  src := replace(src, a3, r3);
  src := replace(src, a4, r4);
  execute src;
end $do$;

do $do$
declare
  src text := pg_get_functiondef('public.import_hubspot_batch(jsonb)'::regprocedure);
  a1 text := $a$      if v_company is not null then
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
      end if;$a$;
  r1 text := $a$      -- owners-era company-name links retired (stage 2b): a name match is a guess and
      -- must not seat contacts.company_id; owner_links stays 0.$a$;
  a2 text := $a$      if v_addr is not null then
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
      end if;$a$;
  r2 text := $a$      -- owners-era property-address links retired (stage 2b): same guess rule.$a$;
  a3 text := $a$        select id into v_contact from contacts where hubspot_id = cid limit 1;
        continue when v_contact is null;
        update owner_contacts
        set confidence  = 'confirmed',
            verified_at = coalesce(verified_at, now()),
            verified_by = coalesce(verified_by, 'hubspot_deal'),
            match_basis = 'hubspot_deal'
        where contact_id = v_contact and confidence <> 'confirmed';
        if found then n_conf := n_conf + 1; end if;$a$;
  r3 text := $a$        select id into v_contact from contacts where hubspot_id = cid limit 1;
        continue when v_contact is null;
        -- owner_contacts confirmations retired (stage 2b): a HubSpot deal is provenance,
        -- not human verification (R1); kept as a no-op so replays keep working.$a$;
  a4 text := $a$        insert into communications (contact_id, phone, owner_id, channel, direction, occurred_at,$a$;
  r4 text := $a$        insert into communications (contact_id, phone, owner_company_id, channel, direction, occurred_at,$a$;
  a5 text := $a$                (select owner_id from owner_contacts where contact_id = v_contact
                 order by case confidence when 'confirmed' then 0 when 'likely' then 1 else 2 end
                 limit 1),$a$;
  r5 text := $a$                (select company_id from contacts where id = v_contact),$a$;
begin
  if (length(src) - length(replace(src, a1, ''))) / length(a1) <> 1 then
    raise exception 'import_hubspot_batch: company-match anchor not found exactly once';
  end if;
  if (length(src) - length(replace(src, a2, ''))) / length(a2) <> 1 then
    raise exception 'import_hubspot_batch: address-match anchor not found exactly once';
  end if;
  if (length(src) - length(replace(src, a3, ''))) / length(a3) <> 1 then
    raise exception 'import_hubspot_batch: deals-branch anchor not found exactly once';
  end if;
  if (length(src) - length(replace(src, a4, ''))) / length(a4) <> 1 then
    raise exception 'import_hubspot_batch: engagement comm-insert anchor not found exactly once';
  end if;
  if (length(src) - length(replace(src, a5, ''))) / length(a5) <> 1 then
    raise exception 'import_hubspot_batch: owner-subselect anchor not found exactly once';
  end if;
  src := replace(src, a1, r1);
  src := replace(src, a2, r2);
  src := replace(src, a3, r3);
  src := replace(src, a4, r4);
  src := replace(src, a5, r5);
  execute src;
end $do$;
