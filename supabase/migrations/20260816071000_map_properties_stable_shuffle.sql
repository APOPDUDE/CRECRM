-- map_properties: spatially fair rows when the box holds more than the cap.
--
-- The box CTE had LIMIT with no ORDER BY, so the first-1000 rows were whatever the
-- lat/lng index scan yielded — in practice south-first, which painted every pin along
-- the bottom edge of a zoomed-out map (Alex, 2026-08-16: "the pins seem to spawn at
-- the bottom"). ORDER BY hashtext(id) is a stable pseudo-random shuffle: the sample is
-- geographically unbiased, and the SAME box returns the SAME rows every call (no pin
-- churn between refetches, unlike random()).

create or replace function public.map_properties(
  p_min_lat numeric, p_min_lng numeric, p_max_lat numeric, p_max_lng numeric,
  p_limit integer default 1000
)
returns table(property jsonb, owner_ctx jsonb, total_in_view bigint)
language sql
stable
set search_path to 'public'
as $$
  with box as (
    select v.* from v_map_property v
    where v.lat between p_min_lat and p_max_lat
      and v.lng between p_min_lng and p_max_lng
      and v.source_address not ilike '%unavailable%'
      and v.source_address not ilike 'Portfolio of %'
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
  )
  select to_jsonb(b), to_jsonb(ctx), (select c from n)
  from box b
  left join v_property_owner_context ctx on ctx.property_id = b.id;
$$;
