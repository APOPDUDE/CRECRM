-- Deal counts on the map row, so the table can search through the same RPC.
--
-- Map rows were everything a pin needs but not everything a TABLE row needs: the Deals
-- column reads linked listings + pursuits, and the map faked them as empty. That was fine
-- while only the map used these RPCs, but it left the table searching a different way from
-- the map — type an owner's name in the table and nothing came back, because the browser's
-- haystack has no owners in it. Two subqueries per row cost 13ms across 1,000 rows, which
-- is a cheap price for one search everywhere.
--
-- Also pins name_has_all_tokens' search_path, which the Supabase advisor flags on anything
-- `authenticated` can execute.

create or replace function name_has_all_tokens(p_text text, p_tokens text[], p_n integer)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_text is not null and p_tokens is not null and not exists (
    select 1
    from unnest(p_tokens) with ordinality as u(tok, ord)
    where case
            when u.ord = p_n then ' ' || p_text not like '% ' || u.tok || '%'
            else ' ' || p_text || ' ' not like '% ' || u.tok || ' %'
          end
  );
$$;

create or replace view v_map_property
with (security_invoker = true) as
select
  p.id,
  coalesce(p.site_address, p.address) as address,
  p.address as source_address,
  p.city, p.state, p.zip, p.county, p.parcel_number, p.site_address, p.folio,
  p.property_type, p.gross_sf, p.land_acres, p.specs, p.listing_status,
  p.days_on_market, p.year_built, p.zoning_description, p.zoning_district,
  p.occupancy, p.lat, p.lng, p.owner_id, p.owner_name, p.owner_mailing_address,
  p.last_sale_date, p.last_sale_price, p.listing_url, p.created_at, p.updated_at,
  (select count(*) from listings l where l.property_id = p.id) as listing_count,
  (select count(*) from pursuits pu where pu.property_id = p.id) as pursuit_count
from properties p;

comment on view v_map_property is
  'The column slice a map pin needs, with the county-first address swap applied and the '
  'linked-deal counts the table shows. Shared by map_properties() and '
  'search_map_properties() so the two cannot disagree about the shape.';

grant select on v_map_property to authenticated;
