-- The sweep RPCs and diagnostic views, repointed at market_listings.
-- See 20260821160000_market_listings_table.sql for why the table exists.

-- ------------------------------------------------------------------------- stamp seen
-- Unchanged signature so the existing n8n node keeps working through the swap. It now
-- stamps the listings too, and reactivation is decided per listing.
create or replace function public.sweep_stamp_seen(p_seen_property_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_seen int := coalesce(array_length(p_seen_property_ids,1),0);
  v_back int := 0;
  v_listings int := 0;
begin
  if v_seen = 0 then
    return jsonb_build_object('seen', 0, 'reactivated', 0, 'listings_stamped', 0);
  end if;

  update market_listings
     set status = 'on_market', off_market_at = null, last_seen_at = now(), updated_at = now()
   where property_id = any(p_seen_property_ids);
  get diagnostics v_listings = row_count;

  update properties
     set listing_status = 'on_market', updated_at = now()
   where id = any(p_seen_property_ids)
     and listing_status = 'off_market';
  get diagnostics v_back = row_count;

  update properties
     set last_seen_in_sweep = now()
   where id = any(p_seen_property_ids);

  return jsonb_build_object('seen', v_seen, 'reactivated', v_back, 'listings_stamped', v_listings);
end $function$;

-- -------------------------------------------------------------------- finalize off-market
-- Now a per-LISTING diff. A listing that stopped coming back goes off_market; the building
-- follows only once EVERY listing on it is off. All three guards are unchanged --
-- floor 300, the 0.85 shrink brake, and the >=20-per-county freshness gate -- and they now
-- count listings, which post-backfill is ~1:1 with the properties they used to count.
create or replace function public.sweep_finalize_off_market(p_counties text[] default null::text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_seen int;
  v_prev int;
  v_off  int := 0;
  v_props int := 0;
  v_fresh text[];
begin
  select count(*) into v_seen
    from market_listings ml
    join properties p on p.id = ml.property_id
   where ml.last_seen_at >= current_date
     and p.property_type::text in ('industrial', 'land')
     and (p_counties is null or p.county = any(p_counties));
  select last_seen_count into v_prev from sweep_meta where id;

  if v_seen < 300 then
    return jsonb_build_object('skipped', true, 'reason', 'seen_below_floor', 'seen', v_seen);
  end if;

  if v_prev is not null and v_seen < (v_prev * 0.85) then
    update sweep_meta set last_run_at = now() where id;
    return jsonb_build_object('skipped', true, 'reason', 'sweep_shrank', 'seen', v_seen, 'prev', v_prev);
  end if;

  select coalesce(array_agg(county), '{}'::text[]) into v_fresh
  from (
    select p.county
    from market_listings ml
    join properties p on p.id = ml.property_id
    where ml.last_seen_at >= current_date
      and p.property_type::text in ('industrial','land')
      and p.county is not null
    group by p.county
    having count(*) >= 20
  ) c;

  update market_listings ml
     set status = 'off_market', off_market_at = now(), updated_at = now()
    from properties p
   where p.id = ml.property_id
     and ml.status = 'on_market'
     and ml.source <> 'crexi'
     and ml.last_seen_at < current_date - 7
     and p.source = 'scrape'
     and p.property_type::text in ('industrial', 'land')
     and p.county = any(v_fresh)
     and (p_counties is null or p.county = any(p_counties));
  get diagnostics v_off = row_count;

  -- Roll the building up: off_market only once nothing on it is still listed.
  update properties p
     set listing_status = 'off_market', updated_at = now()
   where p.source = 'scrape'
     and coalesce(p.source_key,'') not like 'crexi:%'
     and p.property_type::text in ('industrial', 'land')
     and p.listing_status = 'on_market'
     and p.county = any(v_fresh)
     and (p_counties is null or p.county = any(p_counties))
     and exists (select 1 from market_listings ml where ml.property_id = p.id)
     and not exists (select 1 from market_listings ml
                      where ml.property_id = p.id and ml.status = 'on_market');
  get diagnostics v_props = row_count;

  insert into sweep_meta (id, last_seen_count, last_run_at)
  values (true, v_seen, now())
  on conflict (id) do update set last_seen_count = excluded.last_seen_count,
                                 last_run_at = excluded.last_run_at;

  return jsonb_build_object('seen', v_seen, 'prev', v_prev,
                            'listings_off_market', v_off, 'marked_off_market', v_props,
                            'fresh_counties', v_fresh, 'counties', p_counties);
end $function$;

-- --------------------------------------------------------------------------- diagnostics
-- Same two views, now counting listings. fresh_today still mirrors finalize's gate exactly.
create or replace view public.v_sweep_coverage
with (security_invoker = true) as
select
  p.county,
  count(*) filter (where ml.status = 'on_market') as on_market,
  count(*) filter (where ml.last_seen_at >= current_date) as seen_today,
  count(*) filter (where ml.last_seen_at >= current_date - 2) as seen_le_2d,
  count(*) filter (where ml.last_seen_at >= current_date - 7) as seen_le_7d,
  count(*) filter (where ml.last_seen_at <  current_date - 7) as stale_gt_7d,
  count(*) filter (where p.last_seen_in_sweep is null) as never_seen,
  max(ml.last_seen_at) as last_sweep_at,
  round(extract(epoch from now() - max(ml.last_seen_at)) / 3600.0, 1) as hours_since_sweep,
  count(*) filter (where ml.last_seen_at >= current_date) >= 20 as fresh_today
from public.market_listings ml
join public.properties p on p.id = ml.property_id
where p.property_type::text in ('industrial', 'land')
  and ml.source <> 'crexi'
group by p.county;

comment on view public.v_sweep_coverage is
  'Per-county health of the LoopNet sweep, counted per LISTING: how much of the scraped '
  'industrial/land book each county run re-saw, and whether that county is fresh enough today '
  'for sweep_finalize_off_market to age its listings off-market (fresh_today).';

create or replace view public.v_sweep_ingests
with (security_invoker = true) as
select
  ml.last_seen_at as ingested_at,
  count(*) as items,
  count(*) filter (where p.property_type::text = 'industrial') as industrial,
  count(*) filter (where p.property_type::text = 'land') as land,
  string_agg(distinct p.county, ', ' order by p.county) as counties
from public.market_listings ml
join public.properties p on p.id = ml.property_id
where ml.source <> 'crexi'
group by ml.last_seen_at;

comment on view public.v_sweep_ingests is
  'Observed sweep ingests, one row per distinct market_listings.last_seen_at stamp. Still a '
  'LOWER BOUND for anything but the newest run -- a listing re-seen later leaves its earlier '
  'run''s cohort. sweep_runs is the exact per-run record.';

grant select on public.v_sweep_coverage to authenticated, service_role;
grant select on public.v_sweep_ingests  to authenticated, service_role;
