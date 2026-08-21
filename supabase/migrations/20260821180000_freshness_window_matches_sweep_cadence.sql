-- Freshness has to be measured in sweep cycles, not calendar days.
--
-- Why (Alex, 2026-08-21): the sweep drops to **every 3 days** to stay inside the Apify cap.
--
-- Both guards in sweep_finalize_off_market asked "seen since midnight?". That was fine when
-- the sweep ran every morning. On an every-3-days cadence it breaks in a way that is easy to
-- miss, because it fails SILENTLY SAFE and therefore never complains:
--
--   * the 300 floor counts listings seen today -- on the two days out of three when no sweep
--     runs, that count is 0, so finalize returns seen_below_floor and does nothing;
--   * the fresh-pair gate needs >= 20 of a (county, property_type) seen today, so on those
--     same days no pair is ever fresh.
--
-- The off-market finalize is scheduled Sun+Wed. A 3-day sweep cadence drifts against a fixed
-- weekly schedule, so the two would only occasionally coincide -- off-market detection would
-- appear to work while quietly doing nothing most weeks. Nothing would ever be wrongly marked
-- dead; listings would just pile up on-market forever, which is the failure this whole
-- rebuild exists to make visible.
--
-- So the lookback is now a parameter, defaulting to 3 days to match the cadence. It must stay
-- >= the sweep interval and < the 7-day staleness rule, or the two windows cross and a listing
-- could be aged out by the same run that last saw it.

drop function if exists public.sweep_finalize_off_market(text[]);

create or replace function public.sweep_finalize_off_market(
  p_counties text[] default null::text[],
  p_fresh_within_days int default 3)
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
  v_since date;
begin
  -- Must sit between the sweep interval and the 7-day staleness rule.
  if p_fresh_within_days is null or p_fresh_within_days < 0 or p_fresh_within_days >= 7 then
    raise exception 'p_fresh_within_days must be >= 0 and < 7 (the staleness window), got %',
      p_fresh_within_days;
  end if;
  v_since := current_date - p_fresh_within_days;

  select count(*) into v_seen
    from market_listings ml
    join properties p on p.id = ml.property_id
   where ml.last_seen_at >= v_since
     and p.property_type::text in ('industrial', 'land')
     and (p_counties is null or p.county = any(p_counties));
  select last_seen_count into v_prev from sweep_meta where id;

  if v_seen < 300 then
    return jsonb_build_object('skipped', true, 'reason', 'seen_below_floor', 'seen', v_seen,
                              'since', v_since);
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
    where ml.last_seen_at >= v_since
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

  return jsonb_build_object('seen', v_seen, 'prev', v_prev, 'since', v_since,
                            'listings_off_market', v_off, 'marked_off_market', v_props,
                            'fresh_pairs', v_fresh, 'counties', p_counties);
end $function$;

comment on function public.sweep_finalize_off_market(text[], int) is
  'Ages listings off-market that the sweep stopped returning. p_fresh_within_days is the '
  'lookback that decides whether a (county, property_type) camera counts as working -- it must '
  'be >= the sweep interval (3 days as of 2026-08-21) and < the 7-day staleness rule.';

grant execute on function public.sweep_finalize_off_market(text[], int) to authenticated, service_role;

-- The view has to answer the same question, or it stops predicting what finalize will do.
drop view if exists public.v_sweep_coverage;
create view public.v_sweep_coverage
with (security_invoker = true) as
select
  p.county,
  p.property_type::text as property_type,
  count(*) filter (where ml.status = 'on_market') as on_market,
  count(*) filter (where ml.last_seen_at >= current_date) as seen_today,
  count(*) filter (where ml.last_seen_at >= current_date - 3) as seen_le_3d,
  count(*) filter (where ml.last_seen_at >= current_date - 7) as seen_le_7d,
  count(*) filter (where ml.last_seen_at <  current_date - 7) as stale_gt_7d,
  count(*) filter (where p.last_seen_in_sweep is null) as never_seen,
  max(ml.last_seen_at) as last_sweep_at,
  round(extract(epoch from now() - max(ml.last_seen_at)) / 3600.0, 1) as hours_since_sweep,
  -- Mirrors finalize's default 3-day lookback, not "today" -- the sweep runs every 3 days.
  count(*) filter (where ml.last_seen_at >= current_date - 3) >= 20 as fresh_now
from public.market_listings ml
join public.properties p on p.id = ml.property_id
where p.property_type::text in ('industrial', 'land')
  and ml.source <> 'crexi'
group by p.county, p.property_type;

comment on view public.v_sweep_coverage is
  'Per county AND property type: how much of the scraped book that camera re-saw, and whether '
  'the pair is fresh enough for sweep_finalize_off_market to age its listings off-market. '
  'fresh_now uses the same 3-day lookback the function defaults to, because the sweep runs '
  'every 3 days -- a "seen today" test would read as broken on the two days between runs.';

grant select on public.v_sweep_coverage to authenticated, service_role;
