-- Parcel-first identity, phase 1: a scraped listing lands on the property whose PARCEL
-- POLYGON contains its point (context/plan-parcel-first-identity.md, Alex 2026-09-03).
--
-- Step (d) after the 09-02 resolution chain: when nothing matched by building id, filed
-- listing, parcel string or normalized address, drop the listing's lat/lng into gis.parcels
-- (96,871 polygons, the whole book, keyed by property_id). A hit is the building. Listing
-- rows are joined. Keyed rows (parcel:..., addr:..., listings) KEEP their key now -- the
-- parcel key is the building's identity; only unkeyed manual rows take the listing key.
-- 26% of today's parcel-less
-- scraped rows land in a polygon we already hold; phase 2 fetches the parcel for the rest.

CREATE OR REPLACE FUNCTION public.import_scraped_listings(p_props jsonb, p_client_id uuid DEFAULT NULL::uuid, p_flagged_new boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
r jsonb; v_prop_id uuid; v_comp_id uuid; v_pursuit_id uuid; v_owner uuid;
v_key text; v_parcel text; v_loop text; v_rate numeric; v_price numeric;
v_cap numeric; v_price_for_comp numeric;
v_building int; v_space int; v_sf int;
v_last_id uuid; v_last_rate numeric; v_last_price numeric; v_last_cap numeric;
v_props int:=0; v_pursuits int:=0; v_comps int:=0; v_listings int:=0;
v_prop_ids uuid[]:='{}'; v_pursuit_ids uuid[]:='{}';
v_new_prop_ids uuid[]:='{}'; v_existed boolean;
v_claim uuid; v_pkey text; v_alias_key text; v_pk_alnum text;
v_listing_url text; v_broker_name text; v_broker_company text;
v_broker_phone text; v_broker_email text; v_dom int; v_listed_at date;
v_title text; v_descr text; v_sale_conditions text; v_sale_status text;
v_sale_type text; v_is_auction boolean; v_occupancy text; v_src_updated date;
v_lp_id bigint; v_ml_source text; v_ml_id text; v_ml_type deal_type;
v_space_count int; v_rate_max numeric; v_last_rate_max numeric;
begin
if p_client_id is not null then
select owner_id into v_owner from clients where id=p_client_id;
if not found then raise exception 'client % not found', p_client_id; end if;
end if;

for r in select value from jsonb_array_elements(coalesce(p_props,'[]'::jsonb)) as t(value) loop
v_parcel := nullif(r->>'parcel_number','');
v_loop := nullif(r->>'loopnet_id','');
v_key := coalesce(v_parcel,
case when v_loop is not null then 'loopnet:'||v_loop
else coalesce(nullif(r->>'source_key',''), nullif(r->>'source_listing_id','')) end);
if v_key is null then continue; end if;

-- ---- which PROPERTY does this listing belong to? ---------------------------------------
-- v_key is the LISTING's key (comps and the market listing stay keyed on it). v_pkey is
-- the key of the property row we file it under. They differ whenever the building is
-- already in the book under another listing, the county roll, or a merge survivor.
-- 2026-09-02: 3145 US Hwy 92 E existed four times because this step only matched an
-- exact address string and refused to attach to a row that was already a listing.
v_ml_id := coalesce(nullif(r->>'market_listing_id',''), v_loop, v_key);
v_ml_source := coalesce(nullif(r->>'market_source',''),
                        case when v_loop is not null then 'loopnet' else 'scrape' end);
v_pkey := v_key;
v_lp_id := nullif(r->>'loopnet_property_id','')::bigint;

-- (a) the LoopNet building id bridge
if v_lp_id is not null and not exists (select 1 from properties where source_key = v_pkey) then
  select source_key into v_alias_key from properties
  where loopnet_property_id = v_lp_id and source_key is not null limit 1;
  if v_alias_key is not null then v_pkey := v_alias_key; end if;
end if;

-- (b) a listing we have already filed under a property (survives a merge_properties call)
if v_ml_id is not null and not exists (select 1 from properties where source_key = v_pkey) then
  select p.source_key into v_alias_key
  from market_listings ml join properties p on p.id = ml.property_id
  where ml.source = v_ml_source and ml.source_listing_id = v_ml_id and p.source_key is not null
  limit 1;
  if v_alias_key is not null then v_pkey := v_alias_key; end if;
end if;

-- (c) the building itself: by parcel (same city, or within ~1km), then by normalized
--     address in the same city (Highway = Hwy, Lane = Ln, North = N; the county situs in
--     site_address counts too). Parcel-bearing, county-synced, oldest rows win.
v_claim := null; v_alias_key := null;
if not exists (select 1 from properties where source_key = v_pkey) then
  v_pk_alnum := nullif(lower(regexp_replace(split_part(coalesce(v_parcel,''), ',', 1), '[^a-zA-Z0-9]', '', 'g')), '');
  if v_pk_alnum is not null then
    select p.id, p.source_key into v_claim, v_alias_key
    from properties p
    where (split_part(p.parcel_key, '|', 1) = v_pk_alnum
           or (normalize_parcel(v_parcel) is not null and p.folio = normalize_parcel(v_parcel)))
      and not coalesce(p.is_condo_unit, false)
      and (upper(btrim(coalesce(p.city,''))) = upper(btrim(coalesce(r->>'city','')))
           or (p.lat is not null and nullif(r->>'lat','') is not null and nullif(r->>'lng','') is not null
               and abs(p.lat - (r->>'lat')::numeric) < 0.01 and abs(p.lng - (r->>'lng')::numeric) < 0.01))
    order by (p.county_synced_at is not null) desc, p.created_at asc
    limit 1;
  end if;
  if v_claim is null
     and nullif(r->>'address','') is not null
     and lower(trim(r->>'address')) not like 'parcel %'
     and lower(trim(r->>'address')) <> 'address unavailable' then
    select p.id, p.source_key into v_claim, v_alias_key
    from properties p
    where upper(btrim(coalesce(p.city,''))) = upper(btrim(coalesce(r->>'city','')))
      and not coalesce(p.is_condo_unit, false)
      and (normalize_address_text(p.address) = normalize_address_text(r->>'address')
           or normalize_address_text(p.site_address) = normalize_address_text(r->>'address'))
    order by (nullif(split_part(p.parcel_key, '|', 1), '') is not null) desc,
             (p.county_synced_at is not null) desc,
             p.created_at asc
    limit 1;
  end if;
  -- (d) the parcel the listing's point sits in. gis.parcels holds the book's polygons
  --     keyed by property_id, so a hit IS the property. Listings almost never carry a
  --     parcel any more (978 of 987 new rows in Aug 2026 had none) but always carry a
  --     point, and the point is the one thing every source agrees on.
  if v_claim is null
     and nullif(r->>'lat','') is not null and nullif(r->>'lng','') is not null then
    select p.id, p.source_key into v_claim, v_alias_key
    from gis.parcels g
    join properties p on p.id = g.property_id
    where extensions.st_contains(g.geom,
            extensions.st_setsrid(extensions.st_makepoint((r->>'lng')::numeric, (r->>'lat')::numeric), 4326))
      and not coalesce(p.is_condo_unit, false)
    order by (nullif(split_part(p.parcel_key, '|', 1), '') is not null) desc,
             (p.county_synced_at is not null) desc,
             p.created_at asc
    limit 1;
  end if;
  if v_claim is not null then
    if v_alias_key is null then
      -- an unkeyed (manual) row: it takes this listing's key so the upsert can find it
      update properties set source_key = v_pkey where id = v_claim;
    else
      -- a keyed row (parcel:..., addr:..., another listing): file this listing under it and
      -- KEEP its key -- the parcel key is the building's identity (Alex 2026-09-03)
      v_pkey := v_alias_key;
    end if;
  end if;
end if;

select exists(select 1 from properties where source_key = v_pkey) into v_existed;

v_building := coalesce(nullif(r->>'gross_sf','')::int, nullif(r->>'building_sf','')::int);
v_space := nullif(r->>'space_sf_min','')::int;

insert into properties (
address, city, state, zip, property_type, gross_sf, land_acres, specs, description,
source, source_key, loopnet_property_id,
photo_urls, scraped_at, lat, lng,
parcel_number, property_sub_types, building_class, parking_ratio, year_built, year_renovated, stories, num_units,
gross_leasable_area, construction_status, on_ground_lease, zoning_district, zoning_description,
building_far, opportunity_zone,
dock_high_doors, grade_level_doors, clear_height_ft, three_phase_power, volts,
column_spacing, dock_levelers, cross_docks, parking_spaces, construction_material,
truck_court_ft, sprinkler_system, amps, scrape_facts
) values (
coalesce(nullif(r->>'address',''),'Address unavailable'), r->>'city', r->>'state', r->>'zip',
(nullif(r->>'property_type',''))::property_kind, v_building, nullif(r->>'land_acres','')::numeric, r->>'specs',
nullif(r->>'description',''),
coalesce(nullif(r->>'source',''),'scrape'), v_pkey, v_lp_id,
case when jsonb_typeof(r->'photo_urls')='array' then array(select jsonb_array_elements_text(r->'photo_urls')) end,
nullif(r->>'scraped_at','')::timestamptz, nullif(r->>'lat','')::numeric, nullif(r->>'lng','')::numeric,
v_parcel,
case when jsonb_typeof(r->'property_sub_types')='array' then array(select jsonb_array_elements_text(r->'property_sub_types')) end,
nullif(r->>'building_class',''), nullif(r->>'parking_ratio',''),
nullif(r->>'year_built','')::int, nullif(r->>'year_renovated','')::int, nullif(r->>'stories','')::int, nullif(r->>'num_units','')::int,
nullif(r->>'gross_leasable_area',''), nullif(r->>'construction_status',''),
(nullif(r->>'on_ground_lease',''))::boolean, nullif(r->>'zoning_district',''), nullif(r->>'zoning_description',''),
nullif(r->>'building_far',''),
(nullif(r->>'opportunity_zone',''))::boolean,
nullif(r->>'dock_high_doors','')::int, nullif(r->>'grade_level_doors','')::int,
nullif(r->>'clear_height_ft','')::numeric, (nullif(r->>'three_phase_power',''))::boolean, nullif(r->>'volts',''),
nullif(r->>'column_spacing',''), nullif(r->>'dock_levelers','')::int, (nullif(r->>'cross_docks',''))::boolean,
nullif(r->>'parking_spaces','')::int, nullif(r->>'construction_material',''),
nullif(r->>'truck_court_ft','')::numeric, nullif(r->>'sprinkler_system',''), nullif(r->>'amps','')::int,
case when jsonb_typeof(r->'scrape_facts')='object' then r->'scrape_facts' end
)
on conflict (source_key) where source_key is not null
do update set
address=coalesce(nullif(excluded.address,'Address unavailable'), properties.address),
city=coalesce(excluded.city, properties.city), state=coalesce(excluded.state, properties.state), zip=coalesce(excluded.zip, properties.zip),
property_type=coalesce(excluded.property_type, properties.property_type),
gross_sf=coalesce(excluded.gross_sf, properties.gross_sf), land_acres=coalesce(excluded.land_acres, properties.land_acres),
specs=coalesce(excluded.specs, properties.specs),
description=coalesce(properties.description, excluded.description),
loopnet_property_id=coalesce(properties.loopnet_property_id, excluded.loopnet_property_id),
photo_urls=coalesce(excluded.photo_urls, properties.photo_urls),
lat=coalesce(excluded.lat, properties.lat), lng=coalesce(excluded.lng, properties.lng), scraped_at=excluded.scraped_at,
parcel_number=coalesce(excluded.parcel_number, properties.parcel_number),
property_sub_types=coalesce(excluded.property_sub_types, properties.property_sub_types),
building_class=coalesce(excluded.building_class, properties.building_class), parking_ratio=coalesce(excluded.parking_ratio, properties.parking_ratio),
year_built=coalesce(excluded.year_built, properties.year_built), year_renovated=coalesce(excluded.year_renovated, properties.year_renovated),
stories=coalesce(excluded.stories, properties.stories), num_units=coalesce(excluded.num_units, properties.num_units),
gross_leasable_area=coalesce(excluded.gross_leasable_area, properties.gross_leasable_area),
construction_status=coalesce(excluded.construction_status, properties.construction_status),
on_ground_lease=coalesce(excluded.on_ground_lease, properties.on_ground_lease),
zoning_district=coalesce(excluded.zoning_district, properties.zoning_district), zoning_description=coalesce(excluded.zoning_description, properties.zoning_description),
building_far=coalesce(excluded.building_far, properties.building_far), opportunity_zone=coalesce(excluded.opportunity_zone, properties.opportunity_zone),
dock_high_doors=coalesce(excluded.dock_high_doors, properties.dock_high_doors),
grade_level_doors=coalesce(excluded.grade_level_doors, properties.grade_level_doors),
clear_height_ft=coalesce(excluded.clear_height_ft, properties.clear_height_ft),
three_phase_power=coalesce(excluded.three_phase_power, properties.three_phase_power),
volts=coalesce(excluded.volts, properties.volts),
column_spacing=coalesce(excluded.column_spacing, properties.column_spacing),
dock_levelers=coalesce(excluded.dock_levelers, properties.dock_levelers),
cross_docks=coalesce(excluded.cross_docks, properties.cross_docks),
parking_spaces=coalesce(excluded.parking_spaces, properties.parking_spaces),
construction_material=coalesce(excluded.construction_material, properties.construction_material),
truck_court_ft=coalesce(excluded.truck_court_ft, properties.truck_court_ft),
sprinkler_system=coalesce(excluded.sprinkler_system, properties.sprinkler_system),
amps=coalesce(excluded.amps, properties.amps),
scrape_facts=coalesce(excluded.scrape_facts, properties.scrape_facts),
updated_at=now()
returning id into v_prop_id;
v_prop_ids := v_prop_ids || v_prop_id; v_props := v_props+1;
if not v_existed then v_new_prop_ids := v_new_prop_ids || v_prop_id; end if;

v_rate := nullif(r->>'asking_rate_psf','')::numeric;
v_price := nullif(r->>'asking_price','')::numeric;
v_cap := nullif(r->>'cap_rate_pct','')::numeric;
-- U2 (2026-08-29): keep what the placard already told us -- the space count, the TOP of a
-- "$8 - $15" rate range (the low end alone made Cattlemen Rd read as an $8 building), and
-- the listing's own building SF (v_building) on the listing/comp rows.
v_space_count := nullif(r->>'space_count','')::int;
v_rate_max := nullif(r->>'asking_rate_psf_max','')::numeric;
if v_rate_max is not null and v_rate is not null and v_rate_max < v_rate then v_rate_max := v_rate; end if;
v_price_for_comp := case when v_rate is null then v_price else null end;
-- U2: the listing's SIDE decides whether sf is the space, not whether a rate came back.
-- "Upon Request" lease rows used to store the whole building as the space (4531 Madison,
-- decisions.md 2026-08-16) because the old test was v_rate-based.
v_ml_type := coalesce((nullif(r->>'listing_deal_type',''))::deal_type,
                      (case when v_rate is not null then 'lease' else 'sale' end)::deal_type);
if v_ml_type = 'both' then v_ml_type := 'lease'; end if;
v_sf := case when v_ml_type = 'lease' then coalesce(v_space, v_building) else v_building end;

v_listing_url := coalesce(nullif(r->>'listing_url',''), nullif(r->>'source_url',''));
v_broker_name := nullif(r->>'broker_name','');
v_broker_company := nullif(r->>'broker_company','');
v_broker_phone := nullif(r->>'broker_phone','');
v_broker_email := nullif(r->>'broker_email','');
v_dom := nullif(r->>'days_on_market','')::int;
v_listed_at := nullif(r->>'listed_at','')::date;
v_title := nullif(r->>'title','');
v_descr := nullif(r->>'description','');
v_sale_conditions := nullif(r->>'sale_conditions','');
v_sale_status := nullif(r->>'sale_status','');
v_sale_type := nullif(r->>'sale_type','');
v_is_auction := (nullif(r->>'is_auction',''))::boolean;
v_occupancy := nullif(r->>'occupancy','');
v_src_updated := nullif(r->>'source_last_updated','')::date;

-- ---- the market listing itself -------------------------------------------------------
-- v_ml_id / v_ml_source resolved at the top of the loop; v_ml_type computed above.

if v_ml_id is not null then
  insert into market_listings (
    property_id, source, source_listing_id, listing_type, status,
    first_seen_at, last_seen_at, off_market_at,
    asking_rate_psf, asking_price, cap_rate_pct, sqft,
    building_sf, space_count, asking_rate_psf_max,
    broker_name, broker_company, url, raw)
  values (
    v_prop_id, v_ml_source, v_ml_id, v_ml_type, 'on_market',
    now(), now(), null,
    v_rate, v_price_for_comp, v_cap, v_sf,
    v_building, v_space_count, v_rate_max,
    v_broker_name, v_broker_company, v_listing_url,
    case when jsonb_typeof(r->'raw')='object' then r->'raw' end)
  on conflict (source, source_listing_id) do update set
    property_id     = excluded.property_id,
    listing_type    = excluded.listing_type,
    status          = 'on_market',
    last_seen_at    = now(),
    off_market_at   = null,
    asking_rate_psf = coalesce(excluded.asking_rate_psf, market_listings.asking_rate_psf),
    asking_price    = coalesce(excluded.asking_price,    market_listings.asking_price),
    cap_rate_pct    = coalesce(excluded.cap_rate_pct,    market_listings.cap_rate_pct),
    sqft            = coalesce(excluded.sqft,            market_listings.sqft),
    building_sf     = coalesce(excluded.building_sf,     market_listings.building_sf),
    space_count     = coalesce(excluded.space_count,     market_listings.space_count),
    asking_rate_psf_max = coalesce(excluded.asking_rate_psf_max, market_listings.asking_rate_psf_max),
    broker_name     = coalesce(excluded.broker_name,     market_listings.broker_name),
    broker_company  = coalesce(excluded.broker_company,  market_listings.broker_company),
    url             = coalesce(excluded.url,             market_listings.url),
    raw             = coalesce(excluded.raw,             market_listings.raw),
    updated_at      = now();
  v_listings := v_listings + 1;
end if;

select id, asking_lease_rate_psf, sale_price, cap_rate_pct, asking_lease_rate_psf_max
into v_last_id, v_last_rate, v_last_price, v_last_cap, v_last_rate_max
from comps where source_key = v_key and kind = 'asking'
order by as_of_date desc nulls last, created_at desc limit 1;

if v_last_id is null
or v_last_rate is distinct from v_rate
or v_last_price is distinct from v_price_for_comp
or v_last_cap is distinct from v_cap
or (v_rate_max is not null and v_last_rate_max is distinct from v_rate_max) then
insert into comps (property_id, source, source_key, deal_type, kind,
asking_lease_rate_psf, sale_price, cap_rate_pct, sf, as_of_date,
asking_lease_rate_psf_max, space_count, listing_building_sf,
listing_url, broker_name, broker_company, broker_phone, broker_email,
days_on_market, listed_at, listing_title, listing_description,
sale_conditions, sale_status, sale_type, is_auction, occupancy, source_last_updated)
values (v_prop_id, 'scrape', v_key,
-- Which side the LISTING is on, not which price happened to come back. Inferring from
-- "did we get a rate?" filed every rate-less lease listing as a sale comp with no price;
-- the new actor omits price on ~30% of lease rows, so that would have poured junk sale
-- comps into the book the valuations read.
v_ml_type, 'asking',
v_rate, v_price_for_comp, v_cap, v_sf, current_date,
v_rate_max, v_space_count, v_building,
v_listing_url, v_broker_name, v_broker_company, v_broker_phone, v_broker_email,
v_dom, v_listed_at, v_title, v_descr,
v_sale_conditions, v_sale_status, v_sale_type, v_is_auction, v_occupancy, v_src_updated)
returning id into v_comp_id;
v_comps := v_comps+1;
else
update comps set sf = coalesce(v_sf, sf),
property_id = coalesce(v_prop_id, property_id),
asking_lease_rate_psf_max = coalesce(v_rate_max, asking_lease_rate_psf_max),
space_count = coalesce(v_space_count, space_count),
listing_building_sf = coalesce(v_building, listing_building_sf),
listing_url = coalesce(v_listing_url, listing_url),
broker_name = coalesce(v_broker_name, broker_name),
broker_company = coalesce(v_broker_company, broker_company),
broker_phone = coalesce(v_broker_phone, broker_phone),
broker_email = coalesce(v_broker_email, broker_email),
days_on_market = coalesce(v_dom, days_on_market),
listed_at = coalesce(listed_at, v_listed_at),
listing_title = coalesce(v_title, listing_title),
listing_description = coalesce(v_descr, listing_description),
sale_conditions = coalesce(v_sale_conditions, sale_conditions),
sale_status = coalesce(v_sale_status, sale_status),
sale_type = coalesce(v_sale_type, sale_type),
is_auction = coalesce(v_is_auction, is_auction),
occupancy = coalesce(v_occupancy, occupancy),
source_last_updated = coalesce(v_src_updated, source_last_updated),
updated_at = now()
where id = v_last_id;
end if;

if p_client_id is not null then
select id into v_pursuit_id from pursuits where client_id=p_client_id and property_id=v_prop_id limit 1;
if v_pursuit_id is null then
insert into pursuits (property_id, client_id, owner_id, stage, inquiry_date, flagged_new)
values (v_prop_id, p_client_id, v_owner, 'inquiring', current_date, p_flagged_new)
returning id into v_pursuit_id;
v_pursuit_ids := v_pursuit_ids || v_pursuit_id; v_pursuits := v_pursuits+1;
end if;
end if;
end loop;

return jsonb_build_object('properties_upserted', v_props, 'pursuits_created', v_pursuits,
'asking_comps_upserted', v_comps, 'market_listings_upserted', v_listings,
'property_ids', to_jsonb(v_prop_ids),
'new_property_ids', to_jsonb(v_new_prop_ids), 'pursuit_ids', to_jsonb(v_pursuit_ids));
end $function$;
