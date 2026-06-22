-- =========================================================================
-- Static-property column drop, Steps 1-3: repoint matching + market views +
-- import onto the comps time-series (current asking via v_property_current_asking).
-- Keeps properties.asking_rate_psf/asking_price/cap_rate_pct/space_sf_min/space_sf_max
-- + the comps_sync_asking_cache trigger in place (frontend cache) until the
-- frontend is repointed and the columns are dropped in 20260622000005.
-- =========================================================================

-- Step 1a: backfill lease asking comps' sf = available space (range collapses to one value)
update comps c
set sf = coalesce(p.space_sf_min, p.building_sf, c.sf)
from properties p
where c.property_id = p.id and c.kind = 'asking' and c.deal_type = 'lease';

-- Step 1b: import no longer writes the 5 variable cols onto properties; lease asking
-- comp sf = coalesce(space_sf_min, building_sf); sale comp sf = building_sf.
create or replace function public.import_scraped_listings(p_props jsonb, p_client_id uuid DEFAULT NULL::uuid, p_flagged_new boolean DEFAULT false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  r jsonb; v_prop_id uuid; v_comp_id uuid; v_pursuit_id uuid; v_owner uuid;
  v_key text; v_parcel text; v_loop text; v_rate numeric; v_price numeric;
  v_cap numeric; v_price_for_comp numeric;
  v_building int; v_space int; v_sf int;
  v_last_id uuid; v_last_rate numeric; v_last_price numeric; v_last_cap numeric;
  v_props int:=0; v_pursuits int:=0; v_comps int:=0;
  v_prop_ids uuid[]:='{}'; v_pursuit_ids uuid[]:='{}';
begin
  if p_client_id is not null then
    select owner_id into v_owner from clients where id=p_client_id;
    if not found then raise exception 'client % not found', p_client_id; end if;
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_props,'[]'::jsonb)) as t(value) loop
    v_parcel := nullif(r->>'parcel_number','');
    v_loop   := nullif(r->>'loopnet_id','');
    v_key    := coalesce(v_parcel,
                  case when v_loop is not null then 'loopnet:'||v_loop
                       else coalesce(nullif(r->>'source_key',''), nullif(r->>'source_listing_id','')) end);
    if v_key is null then continue; end if;

    v_building := nullif(r->>'building_sf','')::int;
    v_space    := nullif(r->>'space_sf_min','')::int;

    insert into properties (
      address, city, state, zip, property_type, building_sf, land_acres, specs,
      source, source_key, listing_url,
      broker_name, broker_company, broker_phone, broker_email, days_on_market, listed_at, photo_urls, scraped_at, lat, lng,
      parcel_number, title, property_sub_types, building_class, parking_ratio, year_built, year_renovated, stories, num_units,
      gross_leasable_area, construction_status, sale_conditions, occupancy, on_ground_lease, zoning_district, zoning_description,
      sale_status, sale_type, building_far, opportunity_zone, is_auction, source_last_updated
    ) values (
      coalesce(nullif(r->>'address',''),'Address unavailable'), r->>'city', r->>'state', r->>'zip',
      (nullif(r->>'property_type',''))::property_kind, v_building, nullif(r->>'land_acres','')::numeric, r->>'specs',
      coalesce(nullif(r->>'source',''),'scrape'), v_key, coalesce(r->>'listing_url', r->>'source_url'),
      r->>'broker_name', r->>'broker_company', r->>'broker_phone', r->>'broker_email',
      nullif(r->>'days_on_market','')::int, nullif(r->>'listed_at','')::date,
      case when jsonb_typeof(r->'photo_urls')='array' then array(select jsonb_array_elements_text(r->'photo_urls')) end,
      nullif(r->>'scraped_at','')::timestamptz, nullif(r->>'lat','')::numeric, nullif(r->>'lng','')::numeric,
      v_parcel, nullif(r->>'title',''),
      case when jsonb_typeof(r->'property_sub_types')='array' then array(select jsonb_array_elements_text(r->'property_sub_types')) end,
      nullif(r->>'building_class',''), nullif(r->>'parking_ratio',''),
      nullif(r->>'year_built','')::int, nullif(r->>'year_renovated','')::int, nullif(r->>'stories','')::int, nullif(r->>'num_units','')::int,
      nullif(r->>'gross_leasable_area',''), nullif(r->>'construction_status',''), nullif(r->>'sale_conditions',''), nullif(r->>'occupancy',''),
      (nullif(r->>'on_ground_lease',''))::boolean, nullif(r->>'zoning_district',''), nullif(r->>'zoning_description',''),
      nullif(r->>'sale_status','')::int, nullif(r->>'sale_type',''), nullif(r->>'building_far',''),
      (nullif(r->>'opportunity_zone',''))::boolean, (nullif(r->>'is_auction',''))::boolean, nullif(r->>'source_last_updated','')::date
    )
    on conflict (source_key) where source_key is not null
    do update set
      address=coalesce(nullif(excluded.address,'Address unavailable'), properties.address),
      city=coalesce(excluded.city, properties.city), state=coalesce(excluded.state, properties.state), zip=coalesce(excluded.zip, properties.zip),
      property_type=coalesce(excluded.property_type, properties.property_type),
      building_sf=coalesce(excluded.building_sf, properties.building_sf), land_acres=coalesce(excluded.land_acres, properties.land_acres),
      specs=coalesce(excluded.specs, properties.specs),
      days_on_market=excluded.days_on_market,
      broker_name=coalesce(excluded.broker_name, properties.broker_name), broker_company=coalesce(excluded.broker_company, properties.broker_company),
      broker_phone=coalesce(excluded.broker_phone, properties.broker_phone), broker_email=coalesce(excluded.broker_email, properties.broker_email),
      photo_urls=coalesce(excluded.photo_urls, properties.photo_urls), listing_url=coalesce(excluded.listing_url, properties.listing_url),
      lat=coalesce(excluded.lat, properties.lat), lng=coalesce(excluded.lng, properties.lng), scraped_at=excluded.scraped_at,
      parcel_number=coalesce(excluded.parcel_number, properties.parcel_number), title=coalesce(excluded.title, properties.title),
      property_sub_types=coalesce(excluded.property_sub_types, properties.property_sub_types),
      building_class=coalesce(excluded.building_class, properties.building_class), parking_ratio=coalesce(excluded.parking_ratio, properties.parking_ratio),
      year_built=coalesce(excluded.year_built, properties.year_built), year_renovated=coalesce(excluded.year_renovated, properties.year_renovated),
      stories=coalesce(excluded.stories, properties.stories), num_units=coalesce(excluded.num_units, properties.num_units),
      gross_leasable_area=coalesce(excluded.gross_leasable_area, properties.gross_leasable_area),
      construction_status=coalesce(excluded.construction_status, properties.construction_status),
      sale_conditions=coalesce(excluded.sale_conditions, properties.sale_conditions), occupancy=coalesce(excluded.occupancy, properties.occupancy),
      on_ground_lease=coalesce(excluded.on_ground_lease, properties.on_ground_lease),
      zoning_district=coalesce(excluded.zoning_district, properties.zoning_district), zoning_description=coalesce(excluded.zoning_description, properties.zoning_description),
      sale_status=coalesce(excluded.sale_status, properties.sale_status), sale_type=coalesce(excluded.sale_type, properties.sale_type),
      building_far=coalesce(excluded.building_far, properties.building_far), opportunity_zone=coalesce(excluded.opportunity_zone, properties.opportunity_zone),
      is_auction=coalesce(excluded.is_auction, properties.is_auction), source_last_updated=coalesce(excluded.source_last_updated, properties.source_last_updated),
      updated_at=now()
    returning id into v_prop_id;
    v_prop_ids := v_prop_ids || v_prop_id; v_props := v_props+1;

    v_rate := nullif(r->>'asking_rate_psf','')::numeric;
    v_price := nullif(r->>'asking_price','')::numeric;
    v_cap := nullif(r->>'cap_rate_pct','')::numeric;
    v_price_for_comp := case when v_rate is null then v_price else null end;
    v_sf := case when v_rate is not null then coalesce(v_space, v_building) else v_building end;
    if v_rate is not null or v_price is not null then
      select id, asking_lease_rate_psf, sale_price, cap_rate_pct
        into v_last_id, v_last_rate, v_last_price, v_last_cap
        from comps where source_key = v_key and kind = 'asking'
        order by as_of_date desc nulls last, created_at desc limit 1;

      if v_last_id is null
         or v_last_rate is distinct from v_rate
         or v_last_price is distinct from v_price_for_comp
         or v_last_cap is distinct from v_cap then
        insert into comps (property_id, source, source_key, deal_type, kind,
          asking_lease_rate_psf, sale_price, cap_rate_pct, sf, as_of_date)
        values (v_prop_id, 'scrape', v_key,
          (case when v_rate is not null then 'lease' else 'sale' end)::deal_type, 'asking',
          v_rate, v_price_for_comp, v_cap, v_sf, current_date)
        returning id into v_comp_id;
        v_comps := v_comps+1;
      else
        update comps set sf = coalesce(v_sf, sf),
          property_id = coalesce(v_prop_id, property_id), updated_at = now()
          where id = v_last_id;
      end if;
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
    'asking_comps_upserted', v_comps, 'property_ids', to_jsonb(v_prop_ids), 'pursuit_ids', to_jsonb(v_pursuit_ids));
end $function$;

-- Step 2: repoint cross_reference to read current asking from v_property_current_asking
create or replace function public.cross_reference(p_property_ids uuid[])
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_created int := 0;
begin
  with ca as (
    select property_id,
      max(asking_lease_rate_psf) filter (where deal_type='lease') as lease_rate,
      max(sale_price)            filter (where deal_type='sale')  as sale_price,
      max(sf)                    filter (where deal_type='lease') as lease_space,
      max(cap_rate_pct) as cap
    from v_property_current_asking where property_id = any(p_property_ids) group by property_id
  ), new_suggestions as (
    insert into suggestions (property_id, client_id, status)
    select p.id, c.id, 'pending'
    from properties p
    left join ca on ca.property_id = p.id
    join clients c on c.status = 'searching'
    where p.id = any(p_property_ids) and p.source = 'scrape'
      and (c.property_type is null or p.property_type is null or c.property_type = p.property_type)
      and (case when c.deal_type = 'sale' then
            (c.building_sf_min is null or p.building_sf is null or p.building_sf >= c.building_sf_min*0.8)
            and (c.building_sf_max is null or p.building_sf is null or p.building_sf <= c.building_sf_max*1.25)
          else
            (c.building_sf_min is null or coalesce(ca.lease_space,p.building_sf) is null or coalesce(ca.lease_space,p.building_sf) >= c.building_sf_min*0.8)
            and (c.building_sf_max is null or coalesce(ca.lease_space,p.building_sf) is null or coalesce(ca.lease_space,p.building_sf) <= c.building_sf_max*1.25)
          end)
      and ((c.deal_type='lease' and ca.lease_rate is not null)
        or (c.deal_type='sale'  and ca.sale_price is not null)
        or (c.deal_type='both'  and (ca.lease_rate is not null or ca.sale_price is not null)))
      and (c.target_markets is null or (p.city is not null and c.target_markets ilike '%'||p.city||'%'))
      and (c.purpose is distinct from 'investment' or (
            ca.sale_price is not null
            and (ca.cap is null or c.cap_rate_min is null or ca.cap >= c.cap_rate_min)
            and (ca.cap is not null or p.occupancy ~ '[0-9]' or p.sale_type ilike '%investment%'
                 or p.sale_conditions ~* 'exchange|investment|triple net|net lease|leased|portfolio'
                 or p.opportunity_zone is true)))
      and not exists (select 1 from pursuits pu where pu.client_id=c.id and pu.property_id=p.id)
      and not exists (select 1 from suggestions s where s.client_id=c.id and s.property_id=p.id)
    on conflict (property_id, client_id) do nothing
    returning 1
  )
  select count(*) into v_created from new_suggestions;
  return jsonb_build_object('suggestions_created', v_created);
end $function$;

-- Step 3a: repoint v_county_market_stats lease/sale/land CTEs to current-asking comps (DEFINER preserved)
create or replace view public.v_county_market_stats as
 WITH lease AS (
         SELECT p.county,
            p.property_type::text AS ptype,
            ca.asking_lease_rate_psf AS v
           FROM properties p
             JOIN v_property_current_asking ca ON ca.property_id = p.id AND ca.deal_type = 'lease'::deal_type
          WHERE p.county IS NOT NULL AND ca.asking_lease_rate_psf IS NOT NULL AND ca.asking_lease_rate_psf > 0::numeric
        ), sale AS (
         SELECT p.county,
            p.property_type::text AS ptype,
            ca.sale_price / p.building_sf::numeric AS v,
            ca.cap_rate_pct
           FROM properties p
             JOIN v_property_current_asking ca ON ca.property_id = p.id AND ca.deal_type = 'sale'::deal_type
          WHERE p.county IS NOT NULL AND ca.sale_price IS NOT NULL AND p.building_sf IS NOT NULL AND p.building_sf > 0
        ), land AS (
         SELECT p.county,
            ca.sale_price / p.land_acres AS v
           FROM properties p
             JOIN v_property_current_asking ca ON ca.property_id = p.id AND ca.deal_type = 'sale'::deal_type
          WHERE p.county IS NOT NULL AND ca.sale_price IS NOT NULL AND p.land_acres IS NOT NULL AND p.land_acres > 0::numeric AND p.property_type::text = 'land'::text
        ), lstats AS (
         SELECT lease.county,
            lease.ptype,
            count(*) AS n,
            round(avg(lease.v), 2) AS avg_psf,
            round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (lease.v::double precision))::numeric, 2) AS median_psf,
            round(percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (lease.v::double precision))::numeric, 2) AS p25_psf,
            round(percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (lease.v::double precision))::numeric, 2) AS p75_psf
           FROM lease
          GROUP BY GROUPING SETS ((lease.county, lease.ptype), (lease.county))
        ), sstats AS (
         SELECT sale.county,
            sale.ptype,
            count(*) AS n,
            round(avg(sale.v), 2) AS avg_psf,
            round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (sale.v::double precision))::numeric, 2) AS median_psf,
            round(percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (sale.v::double precision))::numeric, 2) AS p25_psf,
            round(percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (sale.v::double precision))::numeric, 2) AS p75_psf,
            round(avg(sale.cap_rate_pct), 2) AS avg_cap,
            count(sale.cap_rate_pct) AS cap_n
           FROM sale
          GROUP BY GROUPING SETS ((sale.county, sale.ptype), (sale.county))
        ), combined AS (
         SELECT COALESCE(l.county, s.county) AS county,
            COALESCE(l.ptype, s.ptype) AS property_type,
            l.n AS lease_n,
            l.avg_psf AS lease_avg_psf,
            l.median_psf AS lease_median_psf,
            l.p25_psf AS lease_p25_psf,
            l.p75_psf AS lease_p75_psf,
            s.n AS sale_n,
            s.avg_psf AS sale_avg_psf,
            s.median_psf AS sale_median_psf,
            s.p25_psf AS sale_p25_psf,
            s.p75_psf AS sale_p75_psf,
            s.avg_cap AS sale_avg_cap,
            s.cap_n AS sale_cap_n
           FROM lstats l
             FULL JOIN sstats s ON l.county = s.county AND COALESCE(l.ptype, '__all__'::text) = COALESCE(s.ptype, '__all__'::text)
        ), dom AS (
         SELECT properties.county,
            count(*) AS listing_n,
            round(avg(properties.days_on_market), 0) AS avg_dom
           FROM properties
          WHERE properties.county IS NOT NULL
          GROUP BY properties.county
        ), landstats AS (
         SELECT land.county,
            count(*) AS n,
            round(avg(land.v), 0) AS avg_per_acre,
            round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (land.v::double precision))::numeric, 0) AS median_per_acre
           FROM land
          GROUP BY land.county
        )
 SELECT c.county,
    c.property_type,
    c.lease_n,
    c.lease_avg_psf,
    c.lease_median_psf,
    c.lease_p25_psf,
    c.lease_p75_psf,
    c.sale_n,
    c.sale_avg_psf,
    c.sale_median_psf,
    c.sale_p25_psf,
    c.sale_p75_psf,
    c.sale_avg_cap,
    c.sale_cap_n,
    ls2.n AS land_n,
    ls2.avg_per_acre AS land_avg_per_acre,
    ls2.median_per_acre AS land_median_per_acre,
    d.listing_n,
    d.avg_dom
   FROM combined c
     LEFT JOIN dom d ON d.county = c.county AND c.property_type IS NULL
     LEFT JOIN landstats ls2 ON ls2.county = c.county AND c.property_type IS NULL;

-- Step 3b: repoint v_property_market_position prop CTE to current-asking comps (DEFINER preserved)
create or replace view public.v_property_market_position as
 WITH prop AS (
         SELECT p.id,
            p.county,
            p.property_type::text AS ptype,
            cal.asking_lease_rate_psf AS asking_rate_psf,
                CASE
                    WHEN cas.sale_price IS NOT NULL AND p.building_sf > 0 THEN round(cas.sale_price / p.building_sf::numeric, 2)
                    ELSE NULL::numeric
                END AS sale_psf,
                CASE
                    WHEN cas.sale_price IS NOT NULL AND p.land_acres > 0::numeric AND p.property_type::text = 'land'::text THEN round(cas.sale_price / p.land_acres, 0)
                    ELSE NULL::numeric
                END AS land_per_acre
           FROM properties p
             LEFT JOIN v_property_current_asking cal ON cal.property_id = p.id AND cal.deal_type = 'lease'::deal_type
             LEFT JOIN v_property_current_asking cas ON cas.property_id = p.id AND cas.deal_type = 'sale'::deal_type
          WHERE p.county IS NOT NULL
        ), base AS (
         SELECT pr.id,
            pr.county,
            pr.ptype,
            pr.asking_rate_psf,
            pr.sale_psf,
            pr.land_per_acre,
            cw.lease_median_psf AS lease_med,
            cw.lease_n,
            cw.sale_median_psf AS sale_med,
            cw.sale_n,
            cw.land_median_per_acre AS land_med,
            cw.land_n
           FROM prop pr
             LEFT JOIN v_county_market_stats cw ON cw.county = pr.county AND cw.property_type IS NULL
        )
 SELECT id,
    county,
    ptype AS property_type,
    asking_rate_psf,
    lease_med AS lease_baseline_median,
    lease_n AS lease_baseline_n,
        CASE
            WHEN asking_rate_psf IS NOT NULL AND ptype IS DISTINCT FROM 'land'::text AND lease_med > 0::numeric AND lease_n >= 4 THEN round((asking_rate_psf - lease_med) / lease_med * 100::numeric, 0)
            ELSE NULL::numeric
        END AS lease_vs_market_pct,
    asking_rate_psf IS NOT NULL AND ptype IS DISTINCT FROM 'land'::text AND lease_med > 0::numeric AND lease_n >= 4 AND asking_rate_psf <= (lease_med * 0.85) AS good_lease_deal,
    sale_psf,
    sale_med AS sale_baseline_median,
    sale_n AS sale_baseline_n,
        CASE
            WHEN sale_psf IS NOT NULL AND ptype IS DISTINCT FROM 'land'::text AND sale_med > 0::numeric AND sale_n >= 4 THEN round((sale_psf - sale_med) / sale_med * 100::numeric, 0)
            ELSE NULL::numeric
        END AS sale_vs_market_pct,
    sale_psf IS NOT NULL AND ptype IS DISTINCT FROM 'land'::text AND sale_med > 0::numeric AND sale_n >= 4 AND sale_psf <= (sale_med * 0.85) AS good_sale_deal,
    land_per_acre,
    land_med AS land_baseline_median,
    land_n AS land_baseline_n,
        CASE
            WHEN land_per_acre IS NOT NULL AND land_med > 0::numeric AND land_n >= 4 THEN round((land_per_acre - land_med) / land_med * 100::numeric, 0)
            ELSE NULL::numeric
        END AS land_vs_market_pct,
    land_per_acre IS NOT NULL AND land_med > 0::numeric AND land_n >= 4 AND land_per_acre <= (land_med * 0.85) AS good_land_deal
   FROM base;
