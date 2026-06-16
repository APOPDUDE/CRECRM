-- Match on the AVAILABLE SPACE size (spaces[].size), not the whole building.
-- summary.buildingSize is the whole building; a lease tenant cares about the suite.
alter table public.properties
  add column if not exists space_sf_min integer,
  add column if not exists space_sf_max integer;

-- import: store the available-space range
create or replace function public.import_scraped_listings(p_props jsonb, p_client_id uuid default null, p_flagged_new boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  r jsonb; v_prop_id uuid; v_comp_id uuid; v_pursuit_id uuid; v_owner uuid;
  v_key text; v_parcel text; v_loop text; v_rate numeric; v_price numeric;
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

    insert into properties (
      address, city, state, zip, property_type, building_sf, land_acres, specs,
      source, source_key, listing_url, asking_price, asking_rate_psf, cap_rate_pct,
      broker_name, broker_company, broker_phone, broker_email, days_on_market, listed_at, photo_urls, scraped_at, lat, lng,
      parcel_number, title, property_sub_types, building_class, parking_ratio, year_built, year_renovated, stories, num_units,
      gross_leasable_area, construction_status, sale_conditions, occupancy, on_ground_lease, zoning_district, zoning_description,
      sale_status, sale_type, building_far, opportunity_zone, is_auction, source_last_updated, space_sf_min, space_sf_max
    ) values (
      coalesce(nullif(r->>'address',''),'Address unavailable'), r->>'city', r->>'state', r->>'zip',
      (nullif(r->>'property_type',''))::property_kind, nullif(r->>'building_sf','')::int, nullif(r->>'land_acres','')::numeric, r->>'specs',
      coalesce(nullif(r->>'source',''),'scrape'), v_key, coalesce(r->>'listing_url', r->>'source_url'),
      nullif(r->>'asking_price','')::numeric, nullif(r->>'asking_rate_psf','')::numeric, nullif(r->>'cap_rate_pct','')::numeric,
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
      (nullif(r->>'opportunity_zone',''))::boolean, (nullif(r->>'is_auction',''))::boolean, nullif(r->>'source_last_updated','')::date,
      nullif(r->>'space_sf_min','')::int, nullif(r->>'space_sf_max','')::int
    )
    on conflict (source_key) where source_key is not null
    do update set
      address=coalesce(nullif(excluded.address,'Address unavailable'), properties.address),
      city=coalesce(excluded.city, properties.city), state=coalesce(excluded.state, properties.state), zip=coalesce(excluded.zip, properties.zip),
      property_type=coalesce(excluded.property_type, properties.property_type),
      building_sf=coalesce(excluded.building_sf, properties.building_sf), land_acres=coalesce(excluded.land_acres, properties.land_acres),
      specs=coalesce(excluded.specs, properties.specs),
      asking_price=coalesce(excluded.asking_price, properties.asking_price), asking_rate_psf=coalesce(excluded.asking_rate_psf, properties.asking_rate_psf),
      cap_rate_pct=coalesce(excluded.cap_rate_pct, properties.cap_rate_pct), days_on_market=excluded.days_on_market,
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
      space_sf_min=coalesce(excluded.space_sf_min, properties.space_sf_min), space_sf_max=coalesce(excluded.space_sf_max, properties.space_sf_max),
      updated_at=now()
    returning id into v_prop_id;
    v_prop_ids := v_prop_ids || v_prop_id; v_props := v_props+1;

    v_rate := nullif(r->>'asking_rate_psf','')::numeric;
    v_price := nullif(r->>'asking_price','')::numeric;
    if v_rate is not null or v_price is not null then
      insert into comps (property_id, source, source_key, deal_type, kind, asking_lease_rate_psf, sale_price, cap_rate_pct, sf)
      values (v_prop_id, 'scrape', v_key,
        (case when v_rate is not null then 'lease' else 'sale' end)::deal_type, 'asking',
        v_rate, case when v_rate is null then v_price else null end, nullif(r->>'cap_rate_pct','')::numeric, nullif(r->>'building_sf','')::int)
      on conflict (source_key) where source_key is not null
      do update set asking_lease_rate_psf=excluded.asking_lease_rate_psf, sale_price=excluded.sale_price, cap_rate_pct=excluded.cap_rate_pct,
        deal_type=excluded.deal_type, sf=coalesce(excluded.sf, comps.sf), property_id=coalesce(excluded.property_id, comps.property_id), updated_at=now()
      returning id into v_comp_id;
      v_comps := v_comps+1;
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
end $$;

-- cross_reference: size match is deal-type aware (lease/both -> available space, sale -> building)
create or replace function public.cross_reference(p_property_ids uuid[])
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_created int := 0;
begin
  with new_suggestions as (
    insert into suggestions (property_id, client_id, status)
    select p.id, c.id, 'pending'
    from properties p
    join clients c on c.status = 'active'
    where p.id = any(p_property_ids)
      and p.source = 'scrape'
      and (c.property_type is null or p.property_type is null or c.property_type = p.property_type)
      and (
        case when c.deal_type = 'sale' then
          (c.building_sf_min is null or p.building_sf is null or p.building_sf >= c.building_sf_min * 0.8)
          and (c.building_sf_max is null or p.building_sf is null or p.building_sf <= c.building_sf_max * 1.25)
        else
          (c.building_sf_min is null or coalesce(p.space_sf_max, p.building_sf) is null or coalesce(p.space_sf_max, p.building_sf) >= c.building_sf_min * 0.8)
          and (c.building_sf_max is null or coalesce(p.space_sf_min, p.building_sf) is null or coalesce(p.space_sf_min, p.building_sf) <= c.building_sf_max * 1.25)
        end
      )
      and (
        (c.deal_type = 'lease' and p.asking_rate_psf is not null) or
        (c.deal_type = 'sale'  and p.asking_price   is not null) or
        (c.deal_type = 'both'  and (p.asking_rate_psf is not null or p.asking_price is not null))
      )
      and (c.target_markets is null or (p.city is not null and c.target_markets ilike '%' || p.city || '%'))
      and (
        c.purpose is distinct from 'investment'
        or (
          p.asking_price is not null
          and (p.cap_rate_pct is null or c.cap_rate_min is null or p.cap_rate_pct >= c.cap_rate_min)
          and (
               p.cap_rate_pct is not null
            or p.occupancy ~ '[0-9]'
            or p.sale_type ilike '%investment%'
            or p.sale_conditions ~* 'exchange|investment|triple net|net lease|leased|portfolio'
            or p.opportunity_zone is true
          )
        )
      )
      and not exists (select 1 from pursuits   pu where pu.client_id = c.id and pu.property_id = p.id)
      and not exists (select 1 from suggestions s  where s.client_id  = c.id and s.property_id  = p.id)
    on conflict (property_id, client_id) do nothing
    returning 1
  )
  select count(*) into v_created from new_suggestions;
  return jsonb_build_object('suggestions_created', v_created);
end $$;
