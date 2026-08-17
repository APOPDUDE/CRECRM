-- R7 FINAL BLOCK — drop the listing-event columns from properties (13 of the
-- planned 14 — see title below).
--
-- ⚠️ PREPARED, NOT APPLIED. Apply ONLY after:
--   1. The repointed app bundle has PROMOTED on Vercel (the properties-rename
--      empty-state trap: a live bundle selecting a dropped column renders empty
--      lists, not errors). The repointed bundle reads every one of these fields
--      from v_property_current_asking / the CurrentAsking map.
--   2. The DB repoints are live: v_map_property / v_county_market_stats /
--      v_property_owner_context / cross_reference() source these fields from the
--      latest asking comp (migrations applied 2026-08-16, this session).
--   3. Rename this file to the version apply_migration actually records.
--
-- What drops (13): listing_url, broker_name, broker_company, broker_phone,
-- broker_email, days_on_market, listed_at, sale_conditions, sale_status,
-- sale_type, is_auction, occupancy, source_last_updated.
-- ⚠️ title is NOT dropped (measured 2026-08-16): import_county_parcels mints
-- county rows with the operating BUSINESS name in properties.title (2,768 rows
-- of "MARLIN JAMES AIR CONDITIONING"-class data, no listing event at all) — a
-- durable fact about the place. Scrape LISTING titles live on
-- comps.listing_title; the importer below stops writing properties.title, so
-- the column becomes exactly "business/DBA name" going forward.
-- What stays: title (business name), description (Alex's editable notes),
-- photo_urls, property_sub_types, on_ground_lease, opportunity_zone,
-- construction_status, specs, scraped_at, listing_status, last_seen_in_sweep.
--
-- Order inside the transaction:
--   A. Data preservation: any property still carrying event data with NO asking
--      comp to hold it gets one minted (fill-only, idempotent) — the pre-R7
--      "rate Upon Request" listings created no comp, and the 20260816013359
--      backfill only filled comps that already existed.
--   B. import_scraped_listings re-created WITHOUT the dropped columns in its
--      properties INSERT/DO UPDATE lists (the usable_acres lesson: the writer
--      must stop naming the column in the same migration). Comp-side event
--      writes are KEPT byte-identical.
--   C. Preflight assert: no view depends on the columns (pg_depend, column-
--      exact) and no live function body still names them against properties
--      (prosrc scan with a verified allowlist) — raises with names if any.
--   D. The drop itself. (Postgres would also hard-fail C's view half natively,
--      but the assert names the offender instead of erroring mid-drop.)

begin;

-- ---------------------------------------------------------------------------
-- A. Mint asking comps for properties whose ONLY listing-event record is the
--    property row (no asking comp at all). deal_type mirrors the importer's
--    unpriced rule (no rate => 'sale'); as_of_date = the listing date we have.
--    source_key r7drop:<id> keeps it idempotent and traceable.
-- ---------------------------------------------------------------------------
insert into comps (
  property_id, source, source_key, deal_type, kind, as_of_date,
  listing_url, broker_name, broker_company, broker_phone, broker_email,
  days_on_market, listed_at, listing_title, sale_conditions, sale_status,
  sale_type, is_auction, occupancy, source_last_updated
)
select
  p.id, coalesce(p.source, 'scrape'), 'r7drop:' || p.id, 'sale'::deal_type,
  'asking'::comp_kind,
  coalesce(p.listed_at, p.scraped_at::date, p.created_at::date),
  p.listing_url, p.broker_name, p.broker_company, p.broker_phone, p.broker_email,
  p.days_on_market, p.listed_at,
  case when p.scraped_at is not null or p.listing_url is not null then p.title end,
  p.sale_conditions, p.sale_status::text,
  p.sale_type, p.is_auction, p.occupancy, p.source_last_updated
from properties p
where not exists (
        select 1 from comps c
        where c.property_id = p.id and c.kind = 'asking'
      )
  and not exists (select 1 from comps c2 where c2.source_key = 'r7drop:' || p.id)
  and (p.listing_url is not null or p.broker_name is not null
       or p.broker_company is not null or p.broker_phone is not null
       or p.broker_email is not null or p.days_on_market is not null
       or p.sale_conditions is not null
       or p.sale_status is not null or p.sale_type is not null
       or p.is_auction is not null or p.occupancy is not null
       or p.source_last_updated is not null
       or p.listed_at is not null);
-- (Safety re-run of migration 20260816090000 — identical predicate, identical
-- source_key, so it inserts only rows that appeared between then and now.
-- title qualifies nothing: county business names are not listing events.)

-- ---------------------------------------------------------------------------
-- B. import_scraped_listings without the properties-side event columns.
--    Byte-identical to the live 20260816013052 body EXCEPT: the 14 columns are
--    gone from the properties INSERT list, its VALUES, and the DO UPDATE SET.
--    The comp-side event insert/update is unchanged — the asking comp is the
--    listing-event record.
--    ⚠️ Before applying, diff this body against live pg_get_functiondef —
--    if the live function changed after 2026-08-16, port the change.
-- ---------------------------------------------------------------------------
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
v_props int:=0; v_pursuits int:=0; v_comps int:=0;
v_prop_ids uuid[]:='{}'; v_pursuit_ids uuid[]:='{}';
v_new_prop_ids uuid[]:='{}'; v_existed boolean;
v_claim uuid;
v_listing_url text; v_broker_name text; v_broker_company text;
v_broker_phone text; v_broker_email text; v_dom int; v_listed_at date;
v_title text; v_descr text; v_sale_conditions text; v_sale_status text;
v_sale_type text; v_is_auction boolean; v_occupancy text; v_src_updated date;
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

v_claim := null;
if nullif(r->>'address','') is not null
and lower(trim(r->>'address')) not like 'parcel %'
and lower(trim(r->>'address')) <> 'address unavailable'
and not exists (select 1 from properties where source_key = v_key) then
select id into v_claim from properties
where lower(trim(address)) = lower(trim(r->>'address'))
and lower(coalesce(trim(city),'')) = lower(coalesce(trim(r->>'city'),''))
order by created_at asc
limit 1;
if v_claim is not null then
update properties set source_key = v_key where id = v_claim;
end if;
end if;

select exists(select 1 from properties where source_key = v_key) into v_existed;

v_building := coalesce(nullif(r->>'gross_sf','')::int, nullif(r->>'building_sf','')::int);
v_space := nullif(r->>'space_sf_min','')::int;

insert into properties (
address, city, state, zip, property_type, gross_sf, land_acres, specs, description,
source, source_key,
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
coalesce(nullif(r->>'source',''),'scrape'), v_key,
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
v_price_for_comp := case when v_rate is null then v_price else null end;
v_sf := case when v_rate is not null then coalesce(v_space, v_building) else v_building end;

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

select id, asking_lease_rate_psf, sale_price, cap_rate_pct
into v_last_id, v_last_rate, v_last_price, v_last_cap
from comps where source_key = v_key and kind = 'asking'
order by as_of_date desc nulls last, created_at desc limit 1;

if v_last_id is null
or v_last_rate is distinct from v_rate
or v_last_price is distinct from v_price_for_comp
or v_last_cap is distinct from v_cap then
insert into comps (property_id, source, source_key, deal_type, kind,
asking_lease_rate_psf, sale_price, cap_rate_pct, sf, as_of_date,
listing_url, broker_name, broker_company, broker_phone, broker_email,
days_on_market, listed_at, listing_title, listing_description,
sale_conditions, sale_status, sale_type, is_auction, occupancy, source_last_updated)
values (v_prop_id, 'scrape', v_key,
(case when v_rate is not null then 'lease' else 'sale' end)::deal_type, 'asking',
v_rate, v_price_for_comp, v_cap, v_sf, current_date,
v_listing_url, v_broker_name, v_broker_company, v_broker_phone, v_broker_email,
v_dom, v_listed_at, v_title, v_descr,
v_sale_conditions, v_sale_status, v_sale_type, v_is_auction, v_occupancy, v_src_updated)
returning id into v_comp_id;
v_comps := v_comps+1;
else
update comps set sf = coalesce(v_sf, sf),
property_id = coalesce(v_prop_id, property_id),
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
'asking_comps_upserted', v_comps, 'property_ids', to_jsonb(v_prop_ids),
'new_property_ids', to_jsonb(v_new_prop_ids), 'pursuit_ids', to_jsonb(v_pursuit_ids));
end $function$;

-- ---------------------------------------------------------------------------
-- C. Preflight: nothing left in the database references the doomed columns.
--    Views via pg_depend (column-exact — a repointed view legitimately says
--    "days_on_market" in its text because COMPS carries that name, so a text
--    scan of view defs would false-positive; the dependency graph cannot).
--    Functions via prosrc scan, minus the allowlist verified comp-side-only.
-- ---------------------------------------------------------------------------
do $$
declare
  -- 13 names — title stays (business/DBA name, county-written; see header)
  cols text[] := array['listing_url','broker_name','broker_company','broker_phone',
    'broker_email','days_on_market','listed_at','sale_conditions',
    'sale_status','sale_type','is_auction','occupancy','source_last_updated'];
  -- verified against pg_get_functiondef at prepare time: these bodies name the
  -- event columns only on COMPS (the import fn re-created above writes them
  -- there by design).
  fn_allow text[] := array['import_scraped_listings'];
  bad text;
begin
  -- views/matviews depending on any of the 14 properties columns
  select string_agg(distinct dep.relname || ' -> ' || att.attname, ', ')
  into bad
  from pg_depend d
  join pg_attribute att on att.attrelid = d.refobjid and att.attnum = d.refobjsubid
  join pg_rewrite rw on rw.oid = d.objid
  join pg_class dep on dep.oid = rw.ev_class
  where d.refobjid = 'public.properties'::regclass
    and d.classid = 'pg_rewrite'::regclass
    and att.attname = any(cols);
  if bad is not null then
    raise exception 'views still read properties event columns: %', bad;
  end if;

  -- live function bodies still naming any of the 14 alongside properties
  select string_agg(p.proname || ' [' || m.col || ']', ', ')
  into bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral (
    select c as col from unnest(cols) c
    where p.prosrc ~* ('\m' || c || '\M')
  ) m
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname <> all(fn_allow)
    and p.prosrc ~* '\mproperties\M';
  if bad is not null then
    raise exception 'functions may still read properties event columns (verify each, then allowlist or fix): %', bad;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- D. The drop.
-- ---------------------------------------------------------------------------
alter table public.properties
  drop column listing_url,
  drop column broker_name,
  drop column broker_company,
  drop column broker_phone,
  drop column broker_email,
  drop column days_on_market,
  drop column listed_at,
  drop column sale_conditions,
  drop column sale_status,
  drop column sale_type,
  drop column is_auction,
  drop column occupancy,
  drop column source_last_updated;

commit;

-- After applying: supabase gen types typescript (the app's database.types.ts
-- still carries the columns until regenerated), and re-run one scrape replay to
-- prove the importer round-trips (the usable_acres proof pattern).
