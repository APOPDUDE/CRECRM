-- Off-market flips require a FRESH successful sweep for that property's county.
--
-- The "always ~100 new off-market sites" (Alex, 2026-08-20) measured out as scraper blocking,
-- not real churn: LoopNet intermittently blocks the kazkn actor, so 4-5 of 7 daily county runs
-- fail with 0 items ("upstream block ... mobile API unavailable"). A county that fails a few
-- days straight ages past the 7-day grace and sweep_finalize_off_market flips its whole tail --
-- properties that are still live on LoopNet -- then they flap back when a run finally lands.
-- Evidence: of on-market industrial/land, only 91 were seen "today" while 568 sat at 4-5 days.
--
-- Fix: a property may only flip off_market when ITS COUNTY's sweep succeeded today (the county
-- has fresh stamps). A failing county's inventory is frozen, not aged out -- absence of
-- evidence isn't evidence of absence when the camera is broken.

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
  v_fresh text[];
begin
  select count(*) into v_seen from properties
   where last_seen_in_sweep >= current_date
     and property_type::text in ('industrial', 'land')
     and (p_counties is null or county = any(p_counties));
  select last_seen_count into v_prev from sweep_meta where id;

  if v_seen < 300 then
    return jsonb_build_object('skipped', true, 'reason', 'seen_below_floor', 'seen', v_seen);
  end if;

  if v_prev is not null and v_seen < (v_prev * 0.85) then
    update sweep_meta set last_run_at = now() where id;
    return jsonb_build_object('skipped', true, 'reason', 'sweep_shrank', 'seen', v_seen, 'prev', v_prev);
  end if;

  -- Counties whose sweep actually landed today (>=20 fresh stamps -- a real run, not a stray).
  select coalesce(array_agg(county), '{}'::text[]) into v_fresh
  from (
    select county from properties
    where last_seen_in_sweep >= current_date
      and property_type::text in ('industrial','land')
      and county is not null
    group by county
    having count(*) >= 20
  ) c;

  update properties
     set listing_status = 'off_market', updated_at = now()
   where source = 'scrape'
     and coalesce(source_key,'') not like 'crexi:%'
     and property_type::text in ('industrial', 'land')
     and last_seen_in_sweep is not null
     and last_seen_in_sweep < current_date - 7
     and listing_status = 'on_market'
     and county = any(v_fresh)          -- only counties the sweep re-saw TODAY may age out
     and (p_counties is null or county = any(p_counties));
  get diagnostics v_off = row_count;

  insert into sweep_meta (id, last_seen_count, last_run_at)
  values (true, v_seen, now())
  on conflict (id) do update set last_seen_count = excluded.last_seen_count,
                                 last_run_at = excluded.last_run_at;

  return jsonb_build_object('seen', v_seen, 'prev', v_prev, 'marked_off_market', v_off,
                            'fresh_counties', v_fresh, 'counties', p_counties);
end $function$;

comment on function sweep_finalize_off_market(text[]) is
  'Ages on-market scraped industrial/land to off_market after 7 unseen days -- but ONLY in '
  'counties whose sweep succeeded today (>=20 fresh stamps). A blocked scraper freezes its '
  'county instead of mass-flipping live listings.';
