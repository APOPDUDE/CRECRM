-- Read-only diagnostics for the per-county LoopNet sweep. No behaviour change.
--
-- Alex, 2026-08-21: "some actors fail and some aren't". Answering that today means
-- forensics over properties.last_seen_in_sweep, because nothing records a run: the
-- column is overwritten on every stamp, so a failed county is indistinguishable from
-- a county nobody scheduled. These two views make the standing question one query.
--
-- v_sweep_coverage   -- per county: is that camera working TODAY, and what does it see?
--                       fresh_today mirrors the >=20-stamp gate sweep_finalize_off_market
--                       uses to decide whether a county may age listings off-market, so
--                       the view answers "will finalize touch this county?" directly.
-- v_sweep_ingests    -- one row per observed ingest (a distinct stamp timestamp).
--                       LOWER BOUND for anything but the newest run: a property re-stamped
--                       by a later run leaves its earlier run's cohort. Exact for the most
--                       recent run only. Real per-run truth needs a run log written by WF3
--                       (n8n side, not built).
--
-- Scope matches sweep_finalize_off_market: scraped, LoopNet-keyed, industrial/land.

create or replace view public.v_sweep_coverage
with (security_invoker = true) as
select
  p.county,
  count(*) filter (where p.listing_status = 'on_market') as on_market,
  count(*) filter (where p.last_seen_in_sweep >= current_date) as seen_today,
  count(*) filter (where p.last_seen_in_sweep >= current_date - 2) as seen_le_2d,
  count(*) filter (where p.last_seen_in_sweep >= current_date - 7) as seen_le_7d,
  count(*) filter (where p.last_seen_in_sweep <  current_date - 7) as stale_gt_7d,
  count(*) filter (where p.last_seen_in_sweep is null) as never_seen,
  max(p.last_seen_in_sweep) as last_sweep_at,
  round(extract(epoch from now() - max(p.last_seen_in_sweep)) / 3600.0, 1) as hours_since_sweep,
  -- The gate sweep_finalize_off_market applies before it may age this county out.
  count(*) filter (where p.last_seen_in_sweep >= current_date) >= 20 as fresh_today
from public.properties p
where p.source = 'scrape'
  and p.property_type::text in ('industrial', 'land')
  and coalesce(p.source_key, '') not like 'crexi:%'
group by p.county;

comment on view public.v_sweep_coverage is
  'Per-county health of the LoopNet sweep: how much of the scraped industrial/land book '
  'each county run re-saw, and whether that county is fresh enough today for '
  'sweep_finalize_off_market to age its listings off-market (fresh_today).';

create or replace view public.v_sweep_ingests
with (security_invoker = true) as
select
  p.last_seen_in_sweep as ingested_at,
  count(*) as items,
  count(*) filter (where p.property_type::text = 'industrial') as industrial,
  count(*) filter (where p.property_type::text = 'land') as land,
  string_agg(distinct p.county, ', ' order by p.county) as counties
from public.properties p
where p.source = 'scrape'
  and p.last_seen_in_sweep is not null
  and coalesce(p.source_key, '') not like 'crexi:%'
group by p.last_seen_in_sweep;

comment on view public.v_sweep_ingests is
  'Observed sweep ingests, one row per distinct stamp timestamp. items is a LOWER BOUND '
  'for every run but the newest -- last_seen_in_sweep is overwritten, so a property '
  're-seen later drops out of its earlier run. Use it for "how many county runs delivered '
  'anything today", not for exact historical run sizes.';

grant select on public.v_sweep_coverage to authenticated, service_role;
grant select on public.v_sweep_ingests  to authenticated, service_role;
