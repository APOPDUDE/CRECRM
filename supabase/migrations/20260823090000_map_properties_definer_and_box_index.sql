-- Applied 2026-08-23 via MCP. The two CREATE INDEX CONCURRENTLY statements were run on
-- their own via execute_sql (CIC cannot run inside a transaction, and apply_migration
-- wraps its payload in one); the function replacement was applied normally.
--
-- ============================================================================
-- WHY: the map was slow for `authenticated` and fast for `postgres`
-- ============================================================================
--
-- Same query, two roles, EXPLAIN on 2026-08-22:
--
--   as postgres      -> Index Scan using properties_lat_lng_idx
--                       Index Cond: lat >= .. AND lat <= .. AND lng >= .. AND lng <= ..
--   as authenticated -> Seq Scan on properties
--                       Filter: (NOT land_only) AND (NOT is_va()) AND lat >= .. AND ..
--
-- A sequential scan of properties is >20s at 127,007 rows / 123 MB. The cause is not
-- is_va() being slow; it is that under RLS, a user qual may only be pushed BELOW the
-- security qual (and therefore into an index) when it is LEAKPROOF -- and:
--
--   numeric_ge(numeric,numeric)  proleakproof = false
--   numeric_le(numeric,numeric)  proleakproof = false
--   int4ge, float8ge, texteq     proleakproof = true
--
-- `lat` and `lng` are numeric. So for the authenticated role the lat/lng bounds can
-- never become an Index Cond, and the planner has nothing left but a full scan. This is
-- general: EVERY numeric predicate the War Room asks (SF, acres, price) has the same
-- problem, which is why the filter-first work that follows is also SECURITY DEFINER.
--
-- SECURITY DEFINER runs as the function owner (postgres, who also owns properties), so
-- RLS does not apply and the index is usable. That bypasses the VA silo, so the silo is
-- RE-ASSERTED BY HAND in the function body -- per project rule, new definer paths never
-- inherit it. `va_guard_pre_request` also fails closed for un-whitelisted /rpc/*, but
-- this function must not rely on that alone.
--
-- ============================================================================
-- WHY the two indexes
-- ============================================================================
--
-- With the index usable, the remaining cost was the stable shuffle
-- (`order by hashtext(id::text)`, migration 20260816071000, which keeps a crowded box's
-- 1,000 pins spatially fair instead of a lat-ordered band). It needs `id` for every row
-- in the box, and `id` was not in properties_lat_lng_idx -- so it paid a random heap
-- read per row. Measured on the Tampa industrial box (5,362 rows): 1,959 ms.
--
-- properties_map_box_idx carries id/land_only/in_land_book as INCLUDE payload so the
-- whole box scan is Index Only. The two address ILIKEs would have forced the heap back
-- open, so the 33 placeholder rows are excluded by anti-join against their own tiny
-- partial index instead. Verified plan after both indexes:
--
--   Limit -> Sort (top-N heapsort)
--     -> Hash Anti Join
--        -> Index Only Scan using properties_map_box_idx   (5,362 rows, Heap Fetches: 230)
--        -> CTE ph: Index Only Scan using properties_placeholder_idx (33 rows, Heap Fetches: 0)
--   Execution Time: 10.286 ms      (was 1,959 ms)
--
-- Wide zoomed-out land box (99,969 rows): 5,811 ms -> 962 ms cold.
-- The count stays EXACT -- measured 41 ms (industrial) / 1,357 ms (land) at the widest
-- realistic box -- so "N in this area" keeps meaning what it says. No cap, no "5,000+".
--
--   create index concurrently if not exists properties_placeholder_idx
--     on public.properties (id)
--     where address ilike '%unavailable%' or address ilike 'Portfolio of %';
--
--   create index concurrently if not exists properties_map_box_idx
--     on public.properties (lat, lng)
--     include (id, land_only, in_land_book)
--     where lat is not null and lng is not null;
--
-- After applying, verify no cancelled build left an invalid index behind:
--   select indexrelid::regclass from pg_index where not indisvalid;
--
-- ROLLBACK: re-apply the map_properties body from migration
-- 20260821161000_land_book_map_paths.sql (it is unchanged in signature and return type,
-- so nothing else has to move), then optionally drop the two indexes CONCURRENTLY.
-- `properties` itself is not altered by any part of this.

-- Signature and return type are IDENTICAL to the previous definition, so the deployed
-- bundle keeps working and there is no PostgREST overload to disambiguate. Replaced in
-- place rather than versioned to v2: a second name would leave two copies of the box
-- rules to keep in step, which is exactly how the land-book filter drifted before.
create or replace function public.map_properties(
  p_min_lat numeric, p_min_lng numeric, p_max_lat numeric, p_max_lng numeric,
  p_limit integer default 1000,
  p_book text default null
)
returns table(property jsonb, owner_ctx jsonb, total_in_view bigint)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Definer rights bypass properties_va_deny. Re-assert the silo by hand.
  if public.is_va() then
    raise insufficient_privilege using message = 'map_properties: denied to the VA role';
  end if;

  return query
  with ph as materialized (
    -- 33 rows. Anti-joining these is what keeps the box scan Index Only; inlining the
    -- ILIKEs into the box predicate costs a full heap scan to remove 33 rows.
    select p2.id
    from public.properties p2
    where p2.address ilike '%unavailable%'
       or p2.address ilike 'Portfolio of %'
  ),
  box as materialized (
    select p.id
    from public.properties p
    where p.lat between p_min_lat and p_max_lat
      and p.lng between p_min_lng and p_max_lng
      and not exists (select 1 from ph where ph.id = p.id)
      and (p_book is null
           or (p_book = 'industrial' and not p.land_only)
           or (p_book = 'land' and p.in_land_book))
    -- stable spatial fairness (20260816071000): a crowded box gives a scattered 1,000,
    -- not a lat-ordered band across the top of the screen
    order by hashtext(p.id::text)
    limit greatest(p_limit, 1)
  ),
  n as materialized (
    select count(*) c
    from public.properties p
    where p.lat between p_min_lat and p_max_lat
      and p.lng between p_min_lng and p_max_lng
      and not exists (select 1 from ph where ph.id = p.id)
      and (p_book is null
           or (p_book = 'industrial' and not p.land_only)
           or (p_book = 'land' and p.in_land_book))
  )
  -- The payload view and the owner-context view are joined only for the <=1,000 rows
  -- that survived the box, never across the book.
  select to_jsonb(v), to_jsonb(ctx), (select c from n)
  from box b
  join public.v_map_property v on v.id = b.id
  left join public.v_property_owner_context ctx on ctx.property_id = b.id;
end $$;

comment on function public.map_properties(numeric, numeric, numeric, numeric, integer, text) is
  'Viewport pins + owner context + exact total. p_book: null = everything (legacy), '
  '''industrial'' = the normal book (land_only excluded), ''land'' = the land book. '
  'SECURITY DEFINER is REQUIRED, not an optimisation: numeric comparison operators are '
  'not leakproof, so under RLS the lat/lng bounds can never become an Index Cond for the '
  'authenticated role and the planner falls back to a >20s sequential scan. The VA silo '
  'is therefore re-asserted in the body -- do not remove that guard.';

grant execute on function public.map_properties(numeric, numeric, numeric, numeric, integer, text)
  to authenticated, service_role;
revoke execute on function public.map_properties(numeric, numeric, numeric, numeric, integer, text)
  from anon, public;
