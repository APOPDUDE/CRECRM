-- Applied 2026-08-21 via MCP.
--
-- The War Room grows a book toggle (Industrial | Land), so every server read
-- path learns which book is being asked about:
-- * v_map_property gains in_land_book/land_only — APPENDED (the deployed
--   bundle reads this view's to_jsonb keys; append-only, never reorder).
-- * map_properties / search_map_properties gain p_book (null = legacy
--   everything, 'industrial' = not land_only, 'land' = in_land_book).
--   DROP + CREATE, not CREATE OR REPLACE: adding a defaulted parameter via
--   replace would leave two overloads and PostgREST rejects the ambiguity.
--   The deployed bundle calls without p_book and keeps working via the
--   default.
-- The book fetch path (PostgREST table reads in use-properties) filters on
-- the columns directly, no function involved.

begin;

create or replace view v_map_property as
 SELECT p.id,
    COALESCE(p.site_address, p.address) AS address,
    p.address AS source_address,
    p.city,
    p.state,
    p.zip,
    p.county,
    p.parcel_number,
    p.site_address,
    p.folio,
    p.property_type,
    p.gross_sf,
    p.land_acres,
    p.specs,
    p.listing_status,
    ask.days_on_market,
    p.year_built,
    p.zoning_description,
    p.zoning_district,
    ask.occupancy,
    p.lat,
    p.lng,
    p.owner_company_id,
    p.owner_name,
    p.owner_mailing_address,
    p.last_sale_date,
    p.last_sale_price,
    ask.listing_url,
    p.created_at,
    p.updated_at,
    ( SELECT count(*) AS count
           FROM listings l
          WHERE l.property_id = p.id) AS listing_count,
    ( SELECT count(*) AS count
           FROM pursuits pu
          WHERE pu.property_id = p.id) AS pursuit_count,
    p.zoning_type,
    p.zoning_code,
    p.zoning_jurisdiction,
    p.dor_use_code,
    p.is_condo_unit,
    p.in_land_book,
    p.land_only
   FROM properties p
     LEFT JOIN LATERAL ( SELECT (array_remove(array_agg(c.days_on_market ORDER BY c.as_of_date DESC NULLS LAST, c.created_at DESC), NULL::integer))[1] AS days_on_market,
            (array_remove(array_agg(c.occupancy ORDER BY c.as_of_date DESC NULLS LAST, c.created_at DESC), NULL::text))[1] AS occupancy,
            (array_remove(array_agg(c.listing_url ORDER BY c.as_of_date DESC NULLS LAST, c.created_at DESC), NULL::text))[1] AS listing_url
           FROM comps c
          WHERE c.property_id = p.id AND c.kind = 'asking'::comp_kind) ask ON true;

drop function map_properties(numeric, numeric, numeric, numeric, integer);

create function map_properties(
  p_min_lat numeric, p_min_lng numeric, p_max_lat numeric, p_max_lng numeric,
  p_limit integer default 1000,
  p_book text default null
)
returns table(property jsonb, owner_ctx jsonb, total_in_view bigint)
language sql stable
set search_path to 'public'
as $$
  with box as (
    select v.* from v_map_property v
    where v.lat between p_min_lat and p_max_lat
      and v.lng between p_min_lng and p_max_lng
      and v.source_address not ilike '%unavailable%'
      and v.source_address not ilike 'Portfolio of %'
      and (p_book is null
           or (p_book = 'industrial' and not v.land_only)
           or (p_book = 'land' and v.in_land_book))
    order by hashtext(v.id::text)
    limit greatest(p_limit, 1)
  ),
  n as (
    select count(*) c
    from properties p
    where p.lat between p_min_lat and p_max_lat
      and p.lng between p_min_lng and p_max_lng
      and p.address not ilike '%unavailable%'
      and p.address not ilike 'Portfolio of %'
      and (p_book is null
           or (p_book = 'industrial' and not p.land_only)
           or (p_book = 'land' and p.in_land_book))
  )
  select to_jsonb(b), to_jsonb(ctx), (select c from n)
  from box b
  left join v_property_owner_context ctx on ctx.property_id = b.id;
$$;

comment on function map_properties(numeric, numeric, numeric, numeric, integer, text) is
  'Viewport pins + owner context + honest total. p_book: null = everything (legacy), '
  '''industrial'' = the normal book (land_only excluded), ''land'' = the land book.';

grant execute on function map_properties(numeric, numeric, numeric, numeric, integer, text)
  to authenticated, service_role;
revoke execute on function map_properties(numeric, numeric, numeric, numeric, integer, text)
  from anon, public;

drop function search_map_properties(text, integer);

create function search_map_properties(
  p_query text,
  p_limit integer default 1000,
  p_book text default null
)
returns table(property jsonb, owner_ctx jsonb, total_in_view bigint)
language sql stable
set search_path to 'public'
as $$
  with hits as (
    select s.id from search_properties(p_query, greatest(p_limit, 1)) s
  ),
  found as (
    select v.* from v_map_property v join hits h on h.id = v.id
    where (p_book is null
           or (p_book = 'industrial' and not v.land_only)
           or (p_book = 'land' and v.in_land_book))
  )
  select to_jsonb(f), to_jsonb(ctx), (select count(*) from found)
  from found f
  left join v_property_owner_context ctx on ctx.property_id = f.id;
$$;

comment on function search_map_properties(text, integer, text) is
  'Typed-search matches from search_properties(), book-filtered like map_properties. '
  'total_in_view counts the book-filtered matches so "N results" is honest per book.';

grant execute on function search_map_properties(text, integer, text)
  to authenticated, service_role;
revoke execute on function search_map_properties(text, integer, text)
  from anon, public;

commit;
