-- Turn appraiser owner NAMES into owner ENTITIES, and point properties at them.
--
-- import_county_parcels writes properties.owner_name (text) but never creates an
-- `owners` row, so a freshly loaded county has owner names and no owner_id. Everything
-- that matters downstream hangs off owner_id, not the text: owner_contacts links, the
-- verified-owner map lens, the skip-trace export's exported/calling/verified states.
-- Hillsborough and Polk were linked by whatever loaded them; Sarasota and Manatee
-- arrived with 4,182 names and zero entities, which is why an owner-email campaign
-- could match the building and still have nothing to attach the person to.
--
-- Identity is normalize_owner_name(), the same fold the GENERATED normalized_name column
-- and its unique index are built on, so this can never create a second row for an owner
-- that already exists -- it adopts the existing entity instead. Re-runnable: already-linked properties are
-- skipped, and mailing address only ever fills a null.

create or replace function link_appraiser_owner_entities(p_county text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  n_owners_new int := 0;
  n_linked     int := 0;
begin
  -- 1. every owner name that has no entity yet becomes one (or adopts an existing one)
  with candidates as (
    select distinct on (normalize_owner_name(owner_name))
           normalize_owner_name(owner_name) as norm,
           btrim(owner_name)                as display,
           owner_mailing_address            as mail
    from properties
    where owner_id is null
      and nullif(btrim(coalesce(owner_name, '')), '') is not null
      and (p_county is null or county = p_county)
    order by normalize_owner_name(owner_name), owner_mailing_address nulls last
  ), inserted as (
    -- normalized_name is GENERATED from display_name -- never inserted, only conflicted on
    insert into owners (display_name, kind, mailing_address)
    select c.display,
      case
        -- government first: "CITY OF X" would otherwise read as an entity
        when c.norm ~ '\m(CITY|COUNTY|STATE|TOWN|VILLAGE)\s+OF\M'
          or c.norm ~ '\m(UNITED STATES|USA|SCHOOL BOARD|SCHOOL DISTRICT|MUNICIPAL|AUTHORITY|DEPT|DEPARTMENT)\M'
          then 'government'::owner_kind
        when c.norm ~ '\m(LLC|INC|CORP|CORPORATION|LP|LLP|LTD|TRUST|TRUSTEE|CO|COMPANY|PARTNERSHIP|ASSOCIATES|ASSOCIATION|HOLDINGS|PROPERTIES|ENTERPRISES|INVESTMENTS|VENTURES|GROUP|FOUNDATION|CHURCH|MINISTRIES|BANK|REALTY|DEVELOPMENT)\M'
          then 'entity'::owner_kind
        else 'individual'::owner_kind
      end,
      c.mail
    from candidates c
    on conflict (normalized_name) do nothing
    returning 1
  )
  select count(*) into n_owners_new from inserted;

  -- 2. point the properties at them
  with linked as (
    update properties pr
    set owner_id = o.id
    from owners o
    where pr.owner_id is null
      and nullif(btrim(coalesce(pr.owner_name, '')), '') is not null
      and o.normalized_name = normalize_owner_name(pr.owner_name)
      and (p_county is null or pr.county = p_county)
    returning 1
  )
  select count(*) into n_linked from linked;

  -- 3. an entity that arrived without a mailing address takes one from its parcels
  update owners o
  set mailing_address = sub.mail
  from (
    select pr.owner_id, min(pr.owner_mailing_address) as mail
    from properties pr
    where pr.owner_id is not null and pr.owner_mailing_address is not null
    group by pr.owner_id
  ) sub
  where o.id = sub.owner_id and o.mailing_address is null;

  return jsonb_build_object('ok', true, 'county', coalesce(p_county, '(all)'),
                            'owners_created', n_owners_new, 'properties_linked', n_linked);
end $$;
