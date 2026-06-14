-- Store lat/lng on scraped properties (for the Deal Map). The n8n map nodes now
-- pass lat/lng from the Apify address; this records them on insert/upsert.
-- (Full function re-declared; only the properties insert/update gains lat, lng.)
create or replace function import_scraped_listings(
  p_props jsonb,
  p_tenant_rep_id uuid default null,
  p_flagged_new boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb;
  v_prop_id uuid;
  v_match_id uuid;
  v_comp_id uuid;
  v_tc uuid;
  v_tk uuid;
  v_sid text;
  v_rate numeric;
  v_props_upserted int := 0;
  v_matches_created int := 0;
  v_comps_upserted int := 0;
  v_prop_ids uuid[] := '{}';
  v_match_ids uuid[] := '{}';
begin
  if p_tenant_rep_id is not null then
    select tenant_company_id, tenant_contact_id into v_tc, v_tk
      from tenant_reps where id = p_tenant_rep_id;
    if not found then
      raise exception 'tenant_rep % not found', p_tenant_rep_id;
    end if;
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_props, '[]'::jsonb)) as t(value)
  loop
    insert into properties (
      address, city, state, zip, property_type, building_sf, land_acres, specs,
      source, source_listing_id, source_url, listing_url, asking_price, asking_rate_psf,
      cap_rate_pct, broker_name, broker_company, broker_phone, broker_email,
      days_on_market, listed_at, photo_urls, scraped_at, lat, lng
    ) values (
      coalesce(nullif(r->>'address',''), 'Address unavailable'),
      r->>'city', r->>'state', r->>'zip',
      (nullif(r->>'property_type',''))::property_kind,
      nullif(r->>'building_sf','')::int,
      nullif(r->>'land_acres','')::numeric,
      r->>'specs',
      coalesce(nullif(r->>'source',''), 'scrape'),
      nullif(r->>'source_listing_id',''),
      r->>'source_url', r->>'listing_url',
      nullif(r->>'asking_price','')::numeric,
      nullif(r->>'asking_rate_psf','')::numeric,
      nullif(r->>'cap_rate_pct','')::numeric,
      r->>'broker_name', r->>'broker_company', r->>'broker_phone', r->>'broker_email',
      nullif(r->>'days_on_market','')::int,
      nullif(r->>'listed_at','')::date,
      case when jsonb_typeof(r->'photo_urls') = 'array'
           then array(select jsonb_array_elements_text(r->'photo_urls')) end,
      nullif(r->>'scraped_at','')::timestamptz,
      nullif(r->>'lat','')::numeric,
      nullif(r->>'lng','')::numeric
    )
    on conflict (source_listing_id) where source_listing_id is not null
    do update set
      asking_price    = coalesce(excluded.asking_price, properties.asking_price),
      asking_rate_psf = coalesce(excluded.asking_rate_psf, properties.asking_rate_psf),
      cap_rate_pct    = coalesce(excluded.cap_rate_pct, properties.cap_rate_pct),
      days_on_market  = excluded.days_on_market,
      broker_name     = coalesce(excluded.broker_name, properties.broker_name),
      broker_company  = coalesce(excluded.broker_company, properties.broker_company),
      broker_phone    = coalesce(excluded.broker_phone, properties.broker_phone),
      broker_email    = coalesce(excluded.broker_email, properties.broker_email),
      photo_urls      = coalesce(excluded.photo_urls, properties.photo_urls),
      listing_url     = coalesce(excluded.listing_url, properties.listing_url),
      lat             = coalesce(excluded.lat, properties.lat),
      lng             = coalesce(excluded.lng, properties.lng),
      scraped_at      = excluded.scraped_at,
      updated_at      = now()
    returning id into v_prop_id;

    v_prop_ids := v_prop_ids || v_prop_id;
    v_props_upserted := v_props_upserted + 1;

    v_sid  := nullif(r->>'source_listing_id', '');
    v_rate := nullif(r->>'asking_rate_psf', '')::numeric;
    if v_rate is not null and v_sid is not null then
      insert into lease_comps (property_id, source, source_listing_id, asking_lease_rate_psf, sf)
      values (v_prop_id, 'scrape', v_sid, v_rate, nullif(r->>'building_sf','')::int)
      on conflict (source_listing_id) where source_listing_id is not null
      do update set
        asking_lease_rate_psf = excluded.asking_lease_rate_psf,
        sf          = coalesce(excluded.sf, lease_comps.sf),
        property_id = coalesce(excluded.property_id, lease_comps.property_id),
        updated_at  = now()
      returning id into v_comp_id;
      v_comps_upserted := v_comps_upserted + 1;
    end if;

    if p_tenant_rep_id is not null then
      select id into v_match_id from matches
        where tenant_rep_id = p_tenant_rep_id and property_id = v_prop_id
        limit 1;
      if v_match_id is null then
        insert into matches (
          property_id, tenant_rep_id, tenant_company_id, tenant_contact_id,
          stage, inquiry_date, flagged_new
        ) values (
          v_prop_id, p_tenant_rep_id, v_tc, v_tk,
          'inquiring', current_date, p_flagged_new
        ) returning id into v_match_id;
        v_match_ids := v_match_ids || v_match_id;
        v_matches_created := v_matches_created + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'properties_upserted', v_props_upserted,
    'matches_created', v_matches_created,
    'asking_comps_upserted', v_comps_upserted,
    'property_ids', to_jsonb(v_prop_ids),
    'match_ids', to_jsonb(v_match_ids)
  );
end $$;

grant execute on function import_scraped_listings(jsonb, uuid, boolean) to authenticated, service_role;
