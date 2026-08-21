-- Keep the broken actor running as a canary, without letting it lie about the live sweep.
--
-- Alex, 2026-08-21: "keep kazkn live so if it starts working again we know". Its six county
-- schedules are back on (~$0.011 per failing run, so ~$0.07/day -- noise next to the ~$1/day
-- the real sweep costs). But its runs now land in the same sweep_runs table as the live
-- azzouzana sweep, and v_sweep_runs_today groups by county alone: a kazkn attempt for Pinellas
-- would make Pinellas look like it reported in, when nothing is scraping Pinellas at all.
--
-- So the production view is scoped to the source that actually feeds the book, and the actor
-- comparison gets a view of its own.

create or replace view public.v_sweep_runs_today
with (security_invoker = true) as
select
  county,
  count(*) as runs,
  count(*) filter (where status = 'SUCCEEDED' and coalesce(item_count, 0) > 0) as succeeded,
  count(*) filter (where status <> 'SUCCEEDED' or coalesce(item_count, 0) = 0) as failed,
  sum(item_count) as items,
  sum(imported) as imported,
  max(finished_at) as last_finished_at,
  (array_remove(array_agg(error order by created_at desc), null))[1] as last_error
from public.sweep_runs
where created_at >= current_date
  and source = 'loopnet'
group by county;

comment on view public.v_sweep_runs_today is
  'Per-county result of the LIVE sweep today (source=loopnet). A county missing from this view '
  'did not run -- the distinction the old last_seen_in_sweep column could never make. '
  'SUCCEEDED with 0 items counts as FAILED here on purpose: that is what a LoopNet block looks '
  'like through azzouzana. Canary actors are excluded; see v_sweep_actor_health.';

-- Is the old actor back? One read, 14 days of history.
create or replace view public.v_sweep_actor_health
with (security_invoker = true) as
select
  (created_at at time zone 'America/New_York')::date as day,
  source,
  count(*) as runs,
  count(*) filter (where status = 'SUCCEEDED' and coalesce(item_count, 0) > 0) as delivered,
  round(100.0 * count(*) filter (where status = 'SUCCEEDED' and coalesce(item_count, 0) > 0)
        / nullif(count(*), 0), 0) as pct_delivered,
  sum(item_count) as items,
  (array_remove(array_agg(error order by created_at desc), null))[1] as last_error
from public.sweep_runs
where created_at >= current_date - 14
group by 1, 2;

comment on view public.v_sweep_actor_health is
  'Per day, per actor: how many runs delivered rows. kazkn/commercial-real-estate-brokerage-intel '
  'stays scheduled purely so this view can show the day its unblocker chain comes back -- it '
  'went 6/6 daily through 2026-08-16, then 1-3 of 6 after scrapingbee''s key expired on 08-18. '
  'A kazkn row climbing back toward 100% means it is worth re-wiring; nothing ingests from it '
  'today (its field shape is the old memo23 placard, not azzouzana''s).';

grant select on public.v_sweep_runs_today   to authenticated, service_role;
grant select on public.v_sweep_actor_health to authenticated, service_role;
