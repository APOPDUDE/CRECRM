-- Applied 2026-08-23 via MCP (recorded as 20260824013149_warroom_page_counts_ids).
--
-- The three callers of warroom_predicate. Each builds the same ph/base skeleton and
-- differs only in what it does with the matching set.
--
-- WHY THREE AND NOT ONE. An exact total has to walk the whole matching set; a page of
-- 100 is an indexed LIMIT. Fusing them makes first paint wait on the count -- and the
-- count is the slow half, because a filter that matches MOST of the book is the
-- expensive case ("Quiet 30d+" matches 34,451 of 34,610). Measured warm:
--
--   warroom_page   industrial page 1      27 ms      (cold 1,225 ms)
--   warroom_page   + county filter       210 ms
--   warroom_counts industrial          2,067 ms
--   warroom_counts + county filter         78 ms
--
-- versus ~26 s to fetch the book. So the client fires the page and the counts in
-- PARALLEL and fills the total in when it lands, rather than blocking on it.
--
-- SECURITY DEFINER on all three, with the VA silo re-asserted by hand: numeric
-- comparison operators are not leakproof, so under RLS no numeric predicate the War Room
-- asks (SF, acres, price, lat/lng) can reach an index. See 20260823090000.
--
-- THE `kept` RULES, in the order the client applies them:
--   * a row passes if it clears the use axes, OR an active overlay include-layer forgives
--     them. `ovi` is the literal `false` when no include layer is on, so this reduces to
--     passes_use by itself and costs nothing.
--   * an active overlay "only" then restricts what survives.
--   * THE CONDO GATE RUNS LAST, so condo_hidden is what THIS view lost rather than the
--     book-wide 2,201 -- and a condo unit is never rescued by the include-union.
--
-- ROLLBACK: drop the three functions. Nothing else references them until the client is
-- pointed at them, and `properties` is untouched by any of this.

create or replace function public.warroom_page(
  p_filters jsonb, p_offset integer default 0, p_limit integer default 100)
returns table (property jsonb, owner_ctx jsonb)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  pr jsonb := public.warroom_predicate(p_filters);
  condos boolean := coalesce((p_filters->>'include_condos')::boolean, false);
  only_on boolean := (pr->>'ovo') <> 'false';
begin
  if public.is_va() then
    raise insufficient_privilege using message = 'warroom_page: denied to the VA role';
  end if;
  -- Hydrated from v_map_property so a page row and a map row are the same shape
  -- downstream -- which is what lets the table and the map share one renderer.
  return query execute format($q$
    with ph as materialized (
      select p2.id from properties p2
      where p2.address ilike '%%unavailable%%' or p2.address ilike 'Portfolio of %%'
    ),
    kept as (
      select p.id, coalesce(p.site_address, p.address) as sort_key
      from properties p
      where true %s
        and ((%s) or (%s))
        and (%L or not coalesce(p.is_condo_unit, false))
        and (%L or (%s))
      order by coalesce(p.site_address, p.address), p.id
      offset %s limit %s
    )
    select to_jsonb(v), to_jsonb(ctx)
    from kept k
    join v_map_property v on v.id = k.id
    left join v_property_owner_context ctx on ctx.property_id = k.id
    order by k.sort_key, k.id
  $q$, pr->>'where', pr->>'use', pr->>'ovi', condos, not only_on, pr->>'ovo',
       greatest(coalesce(p_offset, 0), 0), greatest(coalesce(p_limit, 100), 1));
end $fn$;

create or replace function public.warroom_counts(p_filters jsonb)
returns table (total bigint, condo_hidden bigint)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  pr jsonb := public.warroom_predicate(p_filters);
  condos boolean := coalesce((p_filters->>'include_condos')::boolean, false);
  only_on boolean := (pr->>'ovo') <> 'false';
begin
  if public.is_va() then
    raise insufficient_privilege using message = 'warroom_counts: denied to the VA role';
  end if;
  return query execute format($q$
    with ph as materialized (
      select p2.id from properties p2
      where p2.address ilike '%%unavailable%%' or p2.address ilike 'Portfolio of %%'
    ),
    base as (
      select coalesce(p.is_condo_unit, false) as is_condo,
             (%s) as passes_use, (%s) as ov_include, (%s) as ov_only
      from properties p
      where true %s
    )
    select
      count(*) filter (
        where (passes_use or ov_include)
          and (%L or not is_condo)
          and (%L or ov_only))::bigint,
      -- what the condo lens removed from THIS view: rows that cleared every other filter
      -- AND the use axes, and were dropped only for being unit parcels
      count(*) filter (where not %L and is_condo and passes_use)::bigint
    from base
  $q$, pr->>'use', pr->>'ovi', pr->>'ovo', pr->>'where', condos, not only_on, condos);
end $fn$;

-- The whole matching set, for the three surfaces that legitimately need it: the CSV
-- export, the bulk GHL push and the owner message blast. All are CLICK-time, so none of
-- them is on the first-paint path.
create or replace function public.warroom_ids(p_filters jsonb, p_cap integer default 200000)
returns table (id uuid)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  pr jsonb := public.warroom_predicate(p_filters);
  condos boolean := coalesce((p_filters->>'include_condos')::boolean, false);
  only_on boolean := (pr->>'ovo') <> 'false';
begin
  if public.is_va() then
    raise insufficient_privilege using message = 'warroom_ids: denied to the VA role';
  end if;
  return query execute format($q$
    with ph as materialized (
      select p2.id from properties p2
      where p2.address ilike '%%unavailable%%' or p2.address ilike 'Portfolio of %%'
    )
    select p.id
    from properties p
    where true %s
      and ((%s) or (%s))
      and (%L or not coalesce(p.is_condo_unit, false))
      and (%L or (%s))
    order by coalesce(p.site_address, p.address), p.id
    limit %s
  $q$, pr->>'where', pr->>'use', pr->>'ovi', condos, not only_on, pr->>'ovo',
       greatest(coalesce(p_cap, 200000), 1));
end $fn$;

revoke all on function public.warroom_page(jsonb, integer, integer) from public, anon;
revoke all on function public.warroom_counts(jsonb) from public, anon;
revoke all on function public.warroom_ids(jsonb, integer) from public, anon;
grant execute on function public.warroom_page(jsonb, integer, integer) to authenticated;
grant execute on function public.warroom_counts(jsonb) to authenticated;
grant execute on function public.warroom_ids(jsonb, integer) to authenticated;

comment on function public.warroom_page(jsonb, integer, integer) is
  'One page of the War Room, hydrated from v_map_property so a page row and a map row are '
  'interchangeable downstream. Fire it in PARALLEL with warroom_counts -- the page is an '
  'indexed LIMIT, the exact total is a full walk of the matching set.';
