-- Condo units: separately-assessed unit parcels inside one unitized building/complex
-- (garage condos like the Motor Enclave, warehouse/office condo parks). They flood a
-- market canvass — 236 pins at one Tampa address — so the War Room gets an
-- include/exclude toggle. The classification lives HERE, not in the frontend, per the
-- foundation rules: the flag is a real column any writer/reader sees.
--
-- Why not DOR codes alone: counties file these under their USE (027 auto garages,
-- 041/048 warehousing, 017-019 office), not under the residential condo classes
-- (004-007) — only 23 of ~2,000 condo-unit rows carry a condo DOR class. The reliable
-- tell is structural: 3+ sibling parcels sharing one base address, each with its own
-- unit suffix.

alter table properties
  add column if not exists is_condo_unit boolean not null default false;

comment on column properties.is_condo_unit is
  'Separately-assessed unit parcel in a unitized building (garage/warehouse/office condo). Set by refresh_condo_units(); the War Room excludes these from canvassing by default.';

-- Recompute the flag for the whole book, both directions (self-healing: a row that no
-- longer classifies gets un-flagged). Call after county-parcel imports land new units.
create or replace function refresh_condo_units() returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  n integer;
begin
  with unit_rows as (
    select id, county,
      coalesce(site_address, address) as addr,
      -- Strip ONE trailing unit designator to find the base street address.
      case
        -- explicit designator: "... UNIT B-2", "... STE C", "... APT 4", "... BAY 3"
        when coalesce(site_address, address) ~* '\s(unit|ste|suite|apt|bldg|bay)\s*[#]?\s*[\w.-]+\s*$'
          then regexp_replace(coalesce(site_address, address), '\s(unit|ste|suite|apt|bldg|bay)\s*[#]?\s*[\w.-]+\s*$', '', 'i')
        -- hash form: "... RD # 3-A"
        when coalesce(site_address, address) ~* '\s#\s*[\w.-]+\s*$'
          then regexp_replace(coalesce(site_address, address), '\s#\s*[\w.-]+\s*$', '', 'i')
        -- bare trailing number after a street-type word: "6500 MOTOR ENCLAVE WAY 801"
        when coalesce(site_address, address) ~* '\s(way|st|street|ave|avenue|rd|road|dr|drive|blvd|ln|lane|ct|court|pkwy|hwy|ter|cir|pl|trl|loop)\.?\s+[0-9]+[a-z]?\s*$'
          then regexp_replace(coalesce(site_address, address), '\s+[0-9]+[a-z]?\s*$', '', 'i')
        else null
      end as base
    from properties
  ),
  sibling_bases as (
    select county, base
    from unit_rows
    where base is not null
      -- Road-number guard: "1500 HWY 17" / "0 COUNTY ROAD 542" strip to a base that no
      -- longer names a road — the number WAS the road, not a unit. Measured 2026-08-19:
      -- three such Polk groups; every genuine complex ("6528 301 Hwy") keeps a road name.
      and base !~* '^\d*\s*(us|county|state|fl|cr|sr)?\s*(hwy|highway|rd|road)\s*$'
    group by county, base
    -- 3+ members with 3+ DISTINCT addresses: identical-address repeats are one situs
    -- spanning several parcels (an assemblage), not units.
    having count(*) >= 3 and count(distinct addr) >= 3
  ),
  flagged as (
    -- structural: a unit row whose (county, base) is a known unitized complex
    select u.id
    from unit_rows u
    join sibling_bases sb
      on sb.county is not distinct from u.county and sb.base = u.base
    union
    -- the county's word: DOR class 004 condominia / 005 cooperatives
    -- (normalization matches property_kind_from_dor — keep in lockstep)
    select p.id
    from properties p,
      lateral (select regexp_replace(coalesce(p.dor_use_code, ''), '\D', '', 'g') as d) c,
      lateral (select case
        when c.d = '' then null
        when length(c.d) = 4 then left(c.d, 2)::int
        when length(c.d) >= 5 then left(c.d, 3)::int
        else c.d::int
      end as v) nrm
    where nrm.v in (4, 5)
    union
    -- the scrapers' word: LoopNet marks condo listings in the address/title/sub-types
    select p.id
    from properties p
    where p.address ~* '\(condo\)'
       or coalesce(p.site_address, '') ~* '\(condo\)'
       or p.title ~* '\mcondo(minium)?s?\M'
       or exists (
         select 1 from unnest(coalesce(p.property_sub_types, array[]::text[])) s
         where s ilike '%condo%'
       )
  )
  update properties p
  set is_condo_unit = x.flag
  from (
    select p2.id, (f.id is not null) as flag
    from properties p2
    left join flagged f on f.id = p2.id
  ) x
  where x.id = p.id
    and p.is_condo_unit is distinct from x.flag;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- The map RPCs (map_properties / search_map_properties) read this view; a new
-- properties column only reaches the browser if the view carries it.
create or replace view v_map_property as
 SELECT p.id,
    COALESCE(p.site_address, p.address) AS address,
    p.address AS source_address,
    p.city,
    p.state,
    p.zip,
    p.county,
    p.parcel_number,
    p.site_address,
    p.folio,
    p.property_type,
    p.gross_sf,
    p.land_acres,
    p.specs,
    p.listing_status,
    ask.days_on_market,
    p.year_built,
    p.zoning_description,
    p.zoning_district,
    ask.occupancy,
    p.lat,
    p.lng,
    p.owner_company_id,
    p.owner_name,
    p.owner_mailing_address,
    p.last_sale_date,
    p.last_sale_price,
    ask.listing_url,
    p.created_at,
    p.updated_at,
    ( SELECT count(*) AS count
           FROM listings l
          WHERE l.property_id = p.id) AS listing_count,
    ( SELECT count(*) AS count
           FROM pursuits pu
          WHERE pu.property_id = p.id) AS pursuit_count,
    p.zoning_type,
    p.zoning_code,
    p.zoning_jurisdiction,
    p.dor_use_code,
    p.is_condo_unit
   FROM properties p
     LEFT JOIN LATERAL ( SELECT (array_remove(array_agg(c.days_on_market ORDER BY c.as_of_date DESC NULLS LAST, c.created_at DESC), NULL::integer))[1] AS days_on_market,
            (array_remove(array_agg(c.occupancy ORDER BY c.as_of_date DESC NULLS LAST, c.created_at DESC), NULL::text))[1] AS occupancy,
            (array_remove(array_agg(c.listing_url ORDER BY c.as_of_date DESC NULLS LAST, c.created_at DESC), NULL::text))[1] AS listing_url
           FROM comps c
          WHERE c.property_id = p.id AND c.kind = 'asking'::comp_kind) ask ON true;

-- Backfill now. (properties_push_tags only fires on tags updates — this is webhook-safe.)
select refresh_condo_units();
