-- Viewport-scoped map loading.
--
-- The War Room map used to plot from the whole book: ~17k properties fetched in 18
-- parallel pages, plus the same 17k rows of v_property_owner_context in another 18
-- OFFSET pages. That view costs ~1ms per row to compute, and OFFSET re-computes every
-- preceding row, so page 18 alone walks all 17k — tens of seconds of database work
-- fired the moment the map opened, for a screen that shows a few hundred pins.
--
-- A map only ever needs what is inside the camera. map_properties() answers exactly
-- that: the properties in a lat/lng box, each with its owner context already attached,
-- in one round trip. A Tampa-sized box of 1,500 pins takes ~130ms.

create index if not exists properties_lat_lng_idx
  on properties (lat, lng)
  where lat is not null and lng is not null;

create or replace function map_properties(
  p_min_lat numeric,
  p_min_lng numeric,
  p_max_lat numeric,
  p_max_lng numeric,
  p_limit integer default 1200
)
returns table (property jsonb, owner_ctx jsonb, total_in_view bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with box as (
    select
      p.id, p.address, p.city, p.state, p.zip, p.county, p.parcel_number,
      p.site_address, p.folio, p.property_type, p.gross_sf, p.land_acres, p.specs,
      p.listing_status, p.days_on_market, p.year_built, p.zoning_description,
      p.zoning_district, p.occupancy, p.lat, p.lng, p.owner_id, p.owner_name,
      p.owner_mailing_address, p.last_sale_date, p.last_sale_price, p.listing_url,
      p.created_at, p.updated_at
    from properties p
    where p.lat between p_min_lat and p_max_lat
      and p.lng between p_min_lng and p_max_lng
      -- scrape placeholders that aren't real addresses, same as the list query hides
      and p.address not ilike '%unavailable%'
      and p.address not ilike 'Portfolio of %'
    -- Deliberately unordered: any ORDER BY here makes the planner reach for an index
    -- scan and filter the whole table to honour it (1.3s), where an unordered seq scan
    -- with a LIMIT stops as soon as the box is full (20ms). Which pins get dropped when
    -- a viewport holds more than p_limit is arbitrary but stable for a given box, and
    -- the answer to a crowded viewport is to zoom in, not to pick favourites.
    limit greatest(p_limit, 1)
  ),
  n as (
    select count(*) c
    from properties p
    where p.lat between p_min_lat and p_max_lat
      and p.lng between p_min_lng and p_max_lng
      and p.address not ilike '%unavailable%'
      and p.address not ilike 'Portfolio of %'
  )
  select
    -- County records are the source of truth, so the situs address is what the app
    -- shows/searches/exports and the original rides along as source_address — the same
    -- swap useProperties() does client-side, kept identical so map rows and book rows
    -- are the same shape.
    to_jsonb(b) || jsonb_build_object(
      'address', coalesce(b.site_address, b.address),
      'source_address', b.address
    ),
    to_jsonb(ctx),
    (select c from n)
  from box b
  left join v_property_owner_context ctx on ctx.property_id = b.id;
$$;

comment on function map_properties is
  'Properties inside a lat/lng box with owner context attached, capped at p_limit. The '
  'map''s data source: one bounded round trip per pan instead of the whole book.';

grant execute on function map_properties(numeric, numeric, numeric, numeric, integer)
  to authenticated;
