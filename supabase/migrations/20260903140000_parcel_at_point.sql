-- Parcel-first identity: the parcel polygon WE already hold that contains a point.
-- enrich-appraiser's point lane asks this first -- a hit costs no county round-trip and
-- already names the property (and county) the listing belongs to.
create or replace function parcel_at_point(p_lat numeric, p_lng numeric)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('property_id', p.id, 'county', g.county, 'parcel_number', p.parcel_number,
                            'address', p.address)
  from gis.parcels g
  join properties p on p.id = g.property_id
  where p_lat is not null and p_lng is not null
    and extensions.st_contains(g.geom, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326))
    and not coalesce(p.is_condo_unit, false)
    and nullif(split_part(p.parcel_key, '|', 1), '') is not null
  order by (p.county_synced_at is not null) desc, p.created_at
  limit 1;
$$;
revoke all on function parcel_at_point(numeric, numeric) from public, anon;
