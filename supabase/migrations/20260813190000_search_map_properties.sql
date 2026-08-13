-- Typed search on the map, answered by Postgres.
--
-- map_properties() took the map off the whole book, but a typed search still fell back to
-- it: matching happened in the browser against a haystack built from all ~17k rows, so the
-- first keystroke pulled the book and its owner context — ~20s cold.
--
-- search_properties() already knows what "matches" means (whole-word over address / city /
-- state / zip / county / parcel / folio, last word as a prefix so results appear mid-type).
-- It returns identity columns only, because it was written for a typeahead picker. This
-- wraps it rather than restating the matching: one definition of a match, two shapes.
--
-- The shared column slice moves into a view so map_properties() and search_map_properties()
-- cannot drift about what a map row is.

create or replace view v_map_property
with (security_invoker = true) as
select
  p.id,
  -- County records are the source of truth, so the situs address is what the app shows,
  -- searches, maps and exports; the original rides along as source_address.
  coalesce(p.site_address, p.address) as address,
  p.address as source_address,
  p.city, p.state, p.zip, p.county, p.parcel_number, p.site_address, p.folio,
  p.property_type, p.gross_sf, p.land_acres, p.specs, p.listing_status,
  p.days_on_market, p.year_built, p.zoning_description, p.zoning_district,
  p.occupancy, p.lat, p.lng, p.owner_id, p.owner_name, p.owner_mailing_address,
  p.last_sale_date, p.last_sale_price, p.listing_url, p.created_at, p.updated_at
from properties p;

comment on view v_map_property is
  'The column slice a map pin needs, with the county-first address swap applied. Shared by '
  'map_properties() and search_map_properties() so the two cannot disagree about the shape.';

grant select on v_map_property to authenticated;

create or replace function map_properties(
  p_min_lat numeric,
  p_min_lng numeric,
  p_max_lat numeric,
  p_max_lng numeric,
  p_limit integer default 1000
)
returns table (property jsonb, owner_ctx jsonb, total_in_view bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with box as (
    select v.* from v_map_property v
    where v.lat between p_min_lat and p_max_lat
      and v.lng between p_min_lng and p_max_lng
      -- scrape placeholders that aren't real addresses, same as the list query hides
      and v.source_address not ilike '%unavailable%'
      and v.source_address not ilike 'Portfolio of %'
    -- Deliberately unordered: any ORDER BY here makes the planner reach for an index scan
    -- and filter the whole table to honour it (1.3s), where an unordered seq scan with a
    -- LIMIT stops as soon as the box is full (20ms). Which pins get dropped when a viewport
    -- holds more than p_limit is arbitrary but stable for a given box, and the answer to a
    -- crowded viewport is to zoom in, not to pick favourites.
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
  select to_jsonb(b), to_jsonb(ctx), (select c from n)
  from box b
  left join v_property_owner_context ctx on ctx.property_id = b.id;
$$;

/**
 * Properties matching a typed query, in the shape the map already reads.
 *
 * `total_in_view` is how many came back, not how many exist: search_properties() has no
 * count mode, and running the match twice to get one would cost more than the honesty is
 * worth. The caller treats a full page as "there may be more" and says so.
 */
create or replace function search_map_properties(
  p_query text,
  p_limit integer default 1000
)
returns table (property jsonb, owner_ctx jsonb, total_in_view bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with hits as (
    select s.id from search_properties(p_query, greatest(p_limit, 1)) s
  ),
  found as (
    select v.* from v_map_property v join hits h on h.id = v.id
  )
  select to_jsonb(f), to_jsonb(ctx), (select count(*) from hits)
  from found f
  left join v_property_owner_context ctx on ctx.property_id = f.id;
$$;

comment on function search_map_properties is
  'search_properties() widened to the map row shape, owner context included. Lets the War '
  'Room answer a typed search without fetching the book.';

grant execute on function search_map_properties(text, integer) to authenticated;
