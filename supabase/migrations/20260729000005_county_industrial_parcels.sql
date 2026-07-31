-- Bulk industrial coverage: load every DOR 40xx-49xx parcel from the Hillsborough and Polk
-- appraiser layers, so the book holds the whole industrial market rather than only what was
-- listed. Plus last-sale history, which is the ownership-tenure signal behind "who might sell".

-- ---------------------------------------------------------------- last sale

-- Deliberately NOT written into `comps`: county rolls include $0/$100 quitclaims, intra-family
-- transfers and deed corrections, which would poison the executed-sale comps that the deal model
-- and the county medians read from.
alter table properties
  add column if not exists last_sale_date date,
  add column if not exists last_sale_price numeric(14,2);

create index if not exists properties_last_sale_date_idx
  on properties (last_sale_date) where last_sale_date is not null;

comment on column properties.last_sale_date is
  'Last recorded deed date from the county roll. Tenure = age(last_sale_date). Not a comp: '
  'county sale records include nominal/quitclaim transfers.';
comment on column properties.last_sale_price is
  'Last recorded sale price from the county roll; often 0/100 for non-arms-length transfers.';

-- ---------------------------------------------------------------- bulk parcel import

-- Dedupe order matters: parcel number first (authoritative), then street+city, so a parcel we
-- already hold from LoopNet or the contact-book import is ENRICHED rather than duplicated.
-- Existing rows only get blanks filled -- a listing's own building_sf always outranks the
-- county's heated area, and a human-set property_type always wins over the DOR derivation.
--
--   mode 'parcels' (default) -> bulk parcel upsert
--   mode 'sale_history'      -> last-sale backfill onto parcels we already hold
create or replace function import_county_parcels(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode   text := coalesce(p->>'mode', 'parcels');
  v_county text := p->>'county';
  r        jsonb;
  v_parcel text;
  v_addr   text;
  v_city   text;
  v_date   date;
  v_price  numeric;
  v_id     uuid;
  n_new    int := 0;
  n_upd    int := 0;
  n_skip   int := 0;
  n_miss   int := 0;
begin
  if v_mode = 'sale_history' then
    for r in select * from jsonb_array_elements(p->'rows')
    loop
      v_parcel := nullif(btrim(coalesce(r->>'parcel', '')), '');
      continue when v_parcel is null;

      begin
        v_date := nullif(r->>'date', '')::date;
      exception when others then
        v_date := null;
      end;
      v_price := nullif(r->>'price', '')::numeric;

      update properties pr
      set last_sale_date  = coalesce(v_date, pr.last_sale_date),
          last_sale_price = coalesce(v_price, pr.last_sale_price),
          appraiser_data  = coalesce(pr.appraiser_data, '{}'::jsonb)
            || jsonb_strip_nulls(jsonb_build_object(
                 'grantor', nullif(btrim(coalesce(r->>'grantor', '')), ''),
                 'grantee', nullif(btrim(coalesce(r->>'grantee', '')), '')))
      where pr.parcel_number = v_parcel
        and (v_county is null or pr.county = v_county);

      if found then n_upd := n_upd + 1; else n_miss := n_miss + 1; end if;
    end loop;

    return jsonb_build_object('mode', 'sale_history', 'updated', n_upd,
                              'parcel_not_in_book', n_miss);
  end if;

  if v_county is null then
    return jsonb_build_object('error', 'county required');
  end if;

  for r in select * from jsonb_array_elements(p->'rows')
  loop
    v_parcel := nullif(btrim(coalesce(r->>'parcel', '')), '');
    v_addr   := nullif(btrim(coalesce(r->>'a', '')), '');
    v_city   := nullif(btrim(coalesce(r->>'c', '')), '');

    -- a parcel with no street address can never be mapped or called on; skip it
    if v_parcel is null or v_addr is null or v_addr !~ '\d' then
      n_skip := n_skip + 1;
      continue;
    end if;

    select id into v_id from properties
    where parcel_number = v_parcel and county = v_county limit 1;

    if v_id is null then
      select id into v_id from properties
      where normalize_street(address) = normalize_street(v_addr)
        and (v_city is null or city is null or upper(btrim(city)) = upper(v_city))
      limit 1;
    end if;

    if v_id is null then
      insert into properties (
        address, city, state, zip, county, parcel_number, source, source_key,
        listing_status, property_type, owner_name, owner_mailing_address, dor_use_code,
        building_sf, land_acres, year_built, just_value, assessed_value, lat, lng,
        title, last_sale_date, last_sale_price, appraiser_data, appraiser_updated_at)
      values (
        v_addr, v_city, 'FL', nullif(btrim(coalesce(r->>'z', '')), ''), v_county, v_parcel,
        'county_appraiser', 'parcel:' || lower(v_county) || ':' || v_parcel,
        'off_market', property_kind_from_dor(r->>'dor'),
        nullif(btrim(coalesce(r->>'own', '')), ''),
        nullif(btrim(coalesce(r->>'mail', '')), ''),
        nullif(btrim(coalesce(r->>'dor', '')), ''),
        nullif(r->>'sf', '')::numeric::int, (r->>'ac')::numeric,
        nullif(r->>'yr', '')::numeric::int,
        (r->>'just')::numeric, (r->>'asd')::numeric,
        (r->>'lat')::numeric, (r->>'lng')::numeric,
        nullif(btrim(coalesce(r->>'dba', '')), ''),
        (nullif(r->>'date', ''))::date, nullif(r->>'price', '')::numeric,
        jsonb_build_object('status', 'ok', 'county', v_county, 'matched_by', 'bulk_parcel'),
        now())
      on conflict do nothing;
      if found then n_new := n_new + 1; else n_skip := n_skip + 1; end if;
    else
      update properties pr
      set owner_name            = coalesce(nullif(btrim(coalesce(r->>'own', '')), ''), pr.owner_name),
          owner_mailing_address = coalesce(nullif(btrim(coalesce(r->>'mail', '')), ''), pr.owner_mailing_address),
          dor_use_code          = coalesce(nullif(btrim(coalesce(r->>'dor', '')), ''), pr.dor_use_code),
          just_value            = coalesce((r->>'just')::numeric, pr.just_value),
          assessed_value        = coalesce((r->>'asd')::numeric, pr.assessed_value),
          parcel_number         = coalesce(pr.parcel_number, v_parcel),
          county                = coalesce(pr.county, v_county),
          property_type         = coalesce(pr.property_type, property_kind_from_dor(r->>'dor')),
          building_sf           = coalesce(pr.building_sf, nullif(r->>'sf', '')::numeric::int),
          land_acres            = coalesce(pr.land_acres, (r->>'ac')::numeric),
          year_built            = coalesce(pr.year_built, nullif(r->>'yr', '')::numeric::int),
          lat                   = coalesce(pr.lat, (r->>'lat')::numeric),
          lng                   = coalesce(pr.lng, (r->>'lng')::numeric),
          last_sale_date        = coalesce(pr.last_sale_date, (nullif(r->>'date', ''))::date),
          last_sale_price       = coalesce(pr.last_sale_price, nullif(r->>'price', '')::numeric),
          appraiser_updated_at  = now()
      where pr.id = v_id;
      n_upd := n_upd + 1;
    end if;
  end loop;

  return jsonb_build_object('created', n_new, 'updated', n_upd, 'skipped', n_skip);
end $$;

revoke all on function import_county_parcels(jsonb) from public, anon;
grant execute on function import_county_parcels(jsonb) to service_role, authenticated;
