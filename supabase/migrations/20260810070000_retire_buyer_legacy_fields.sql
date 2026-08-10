-- The client edit form asked for the same thing twice on the buy side: `budget` free text
-- next to price_min/max, and `target_markets` city text next to the drawn target_areas.
-- Two fields for one fact is how they drift apart.
--
-- Rather than deleting either, the structured half is extracted and the words are kept as
-- notes. After this the buy-side form stops offering the legacy pair; the lease side is
-- untouched, because a tenant genuinely uses budget ("$13-15 PSF NNN") and named markets.

-- 1. budget text -> price_max, when it parses and no price is set. "2.5M" -> 2500000,
--    "$5M purchase" -> 5000000, "3000000" -> 3000000.
with parsed as (
  select id,
         (regexp_match(replace(lower(budget), ',', ''), '([0-9]+(?:\.[0-9]+)?)\s*(m|k)?'))[1]::numeric as n,
         (regexp_match(replace(lower(budget), ',', ''), '([0-9]+(?:\.[0-9]+)?)\s*(m|k)?'))[2] as unit
    from public.clients
   where is_rep and deal_type <> 'lease' and budget is not null
)
update public.clients c
   set price_max = case when p.unit = 'm' then p.n * 1000000
                        when p.unit = 'k' then p.n * 1000
                        else p.n end
  from parsed p
 where c.id = p.id and p.n is not null
   and c.price_min is null and c.price_max is null;

-- 2. target_markets city names -> drawn boxes, for buyers with no areas yet. The box is
--    the extent of the properties we already hold in that city, so it is grounded in real
--    geography rather than invented. Cities we do not hold stay as notes only.
with cities as (
  select initcap(lower(city)) as name,
         min(lat) as mn_lat, max(lat) as mx_lat, min(lng) as mn_lng, max(lng) as mx_lng
    from public.properties
   where lat is not null and lng is not null and city is not null and length(city) > 3
   group by initcap(lower(city))
  having count(*) >= 5
), hits as (
  select c.id,
         jsonb_build_object('name', ci.name, 'ring', jsonb_build_array(
           jsonb_build_array(round((ci.mn_lat - 0.01)::numeric, 4), round((ci.mn_lng - 0.01)::numeric, 4)),
           jsonb_build_array(round((ci.mn_lat - 0.01)::numeric, 4), round((ci.mx_lng + 0.01)::numeric, 4)),
           jsonb_build_array(round((ci.mx_lat + 0.01)::numeric, 4), round((ci.mx_lng + 0.01)::numeric, 4)),
           jsonb_build_array(round((ci.mx_lat + 0.01)::numeric, 4), round((ci.mn_lng - 0.01)::numeric, 4))
         )) as area
    from public.clients c
    join cities ci on c.target_markets ilike '%' || ci.name || '%'
   where c.is_rep and c.deal_type <> 'lease'
     and c.target_areas = '[]'::jsonb and c.target_markets is not null
)
update public.clients c
   set target_areas = agg.areas
  from (select id, jsonb_agg(distinct area) as areas from hits group by id) agg
 where c.id = agg.id;

-- 3. Keep the words. Whatever was typed stays readable in the notes, labelled, so nothing
--    that was never structured is lost.
update public.clients
   set must_haves = concat_ws(E'\n\n', nullif(must_haves, ''),
         case when budget is not null then '[from budget] ' || budget end,
         case when target_markets is not null then '[from target markets] ' || target_markets end),
       budget = null,
       target_markets = null
 where is_rep and deal_type <> 'lease'
   and (budget is not null or target_markets is not null);
