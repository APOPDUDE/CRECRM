-- The fresh-county gate has to be per (county, property_type), not per county.
--
-- Why now (Alex, 2026-08-21): the sweep is narrowing to Hillsborough + Polk, **industrial
-- only**, to stay inside the Apify spend cap. Land stops being scraped.
--
-- The old gate reads "did this COUNTY deliver >= 20 listings today?" and, if so, ages out any
-- industrial *or* land listing in it that hasn't been seen for 7 days. Sweep Hillsborough
-- industrial (212 on-market listings) and Hillsborough goes fresh -- then Hillsborough's 71
-- on-market LAND listings, which nothing is scraping any more, age past 7 days and get
-- silently flipped off-market. Same for Polk's 70. That is 141 listings wrongly marked dead
-- purely because we stopped looking at them.
--
-- A camera that only points at industrial can only vouch for industrial. So freshness is now
-- keyed to the (county, property_type) pair actually observed. When both types are swept the
-- behaviour is identical to before -- this only ever refuses to age something out.
--
-- The other two guards are untouched: the 300 floor and the 0.85 shrink brake.

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

  -- 'Hillsborough|industrial' etc. A pair is fresh only if THAT type was seen in THAT county.
  select coalesce(array_agg(county || '|' || ptype), '{}'::text[]) into v_fresh
  from (
    select p.county, p.property_type::text as ptype
    from market_listings ml
    join properties p on p.id = ml.property_id
    where ml.last_seen_at >= current_date
      and p.property_type::text in ('industrial','land')
      and p.county is not null
    group by 1, 2
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
     and (p.county || '|' || p.property_type::text) = any(v_fresh)
     and (p_counties is null or p.county = any(p_counties));
  get diagnostics v_off = row_count;

  -- Roll the building up: off_market only once nothing on it is still listed.
  update properties p
     set listing_status = 'off_market', updated_at = now()
   where p.source = 'scrape'
     and coalesce(p.source_key,'') not like 'crexi:%'
     and p.property_type::text in ('industrial', 'land')
     and p.listing_status = 'on_market'
     and (p.county || '|' || p.property_type::text) = any(v_fresh)
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
                            'fresh_pairs', v_fresh, 'counties', p_counties);
end $function$;

-- Mirror the gate: the view must answer the same question the function asks, or it stops
-- being a way to predict what finalize will do.
create or replace view public.v_sweep_coverage
with (security_invoker = true) as
select
  p.county,
  p.property_type::text as property_type,
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
group by p.county, p.property_type;

comment on view public.v_sweep_coverage is
  'Per county AND property type: how much of the scraped book that camera re-saw, and whether '
  'the pair is fresh enough today for sweep_finalize_off_market to age its listings '
  'off-market. Split by type because the sweep can cover industrial without covering land -- '
  'a county-wide gate would age out land nobody is scraping.';

grant select on public.v_sweep_coverage to authenticated, service_role;
