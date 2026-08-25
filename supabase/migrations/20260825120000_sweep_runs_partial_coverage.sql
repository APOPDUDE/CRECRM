-- A county run that loses one of its four search URLs must not read as a clean success.
--
-- Found 2026-08-25 chasing a real miss. Alex asked why 14525 N FLORIDA AVE, Tampa -- on the
-- market, 6.8 acres -- had never been seen by a sweep. It wasn't a filter problem: the
-- Hillsborough run simply never returned it. The log shows why:
--
--   industrial-properties/hillsborough-county-fl/for-lease/ -> collected 750 ids / 30 pages
--   land/hillsborough-county-fl/for-sale/                   -> collected 200 ids /  9 pages
--   land/hillsborough-county-fl/for-lease/                  -> collected  60 ids /  3 pages
--   industrial-properties/hillsborough-county-fl/for-sale/  -> BLOCKED on every lane, 0 ids
--
-- impit 8 attempts 403, camoufox 2 attempts 403, scrapedo 502, website fallback 0. And the
-- run still exited SUCCEEDED with 960 items, so sweep_runs recorded a healthy county.
-- A quarter of Hillsborough's coverage vanished silently -- exactly the blindness this table
-- was built to remove, one level down from where we removed it.
--
-- item_count cannot catch this: 960 rows from 3 of 4 URLs looks better than a good day from a
-- small county. Only the per-URL count can.

alter table public.sweep_runs
  add column if not exists urls_expected integer,
  add column if not exists urls_ok       integer;

comment on column public.sweep_runs.urls_expected is
  'Search URLs the task was configured with (4 for a county task, 1 for restaurants).';
comment on column public.sweep_runs.urls_ok is
  'How many of them actually returned listing ids. Less than urls_expected means the run lost '
  'coverage even if it exited SUCCEEDED -- status is recorded as PARTIAL in that case.';

-- Same signature as before plus the two counts, so existing callers keep working.
create or replace function public.sweep_log_run(
  p_run_id text,
  p_status text,
  p_source text default 'loopnet',
  p_actor_id text default null,
  p_county text default null,
  p_property_type text default null,
  p_deal_type text default null,
  p_start_url text default null,
  p_item_count integer default null,
  p_imported integer default null,
  p_error text default null,
  p_started_at timestamptz default null,
  p_finished_at timestamptz default null,
  p_urls_expected integer default null,
  p_urls_ok integer default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  insert into sweep_runs (source, actor_id, run_id, county, property_type, deal_type,
                          start_url, status, item_count, imported, error, started_at, finished_at,
                          urls_expected, urls_ok)
  values (coalesce(p_source,'loopnet'), p_actor_id, p_run_id, p_county, p_property_type,
          nullif(p_deal_type,''), p_start_url, p_status, p_item_count, p_imported,
          nullif(p_error,''), p_started_at, p_finished_at, p_urls_expected, p_urls_ok)
  on conflict (source, run_id) do update set
    status        = excluded.status,
    item_count    = coalesce(excluded.item_count, sweep_runs.item_count),
    imported      = coalesce(excluded.imported,   sweep_runs.imported),
    error         = coalesce(excluded.error,      sweep_runs.error),
    county        = coalesce(excluded.county,     sweep_runs.county),
    property_type = coalesce(excluded.property_type, sweep_runs.property_type),
    deal_type     = coalesce(excluded.deal_type,  sweep_runs.deal_type),
    start_url     = coalesce(excluded.start_url,  sweep_runs.start_url),
    actor_id      = coalesce(excluded.actor_id,   sweep_runs.actor_id),
    started_at    = coalesce(excluded.started_at, sweep_runs.started_at),
    finished_at   = coalesce(excluded.finished_at, sweep_runs.finished_at),
    urls_expected = coalesce(excluded.urls_expected, sweep_runs.urls_expected),
    urls_ok       = coalesce(excluded.urls_ok,       sweep_runs.urls_ok)
  returning id into v_id;
  return v_id;
end $function$;

grant execute on function public.sweep_log_run(text,text,text,text,text,text,text,text,integer,integer,text,timestamptz,timestamptz,integer,integer)
  to authenticated, service_role;

-- PARTIAL now counts as not-delivered, so the retry re-runs that county and the view stops
-- calling a three-quarters run a success.
-- Dropped rather than replaced: the new columns land mid-list, and CREATE OR REPLACE VIEW
-- cannot reorder or insert columns.
drop view if exists public.v_sweep_runs_today;
create view public.v_sweep_runs_today
with (security_invoker = true) as
select
  county,
  count(*) as runs,
  count(*) filter (where status = 'SUCCEEDED' and coalesce(item_count, 0) > 0) as succeeded,
  count(*) filter (where status <> 'SUCCEEDED' or coalesce(item_count, 0) = 0) as failed,
  sum(item_count) as items,
  sum(imported) as imported,
  min(urls_ok) as urls_ok,
  max(urls_expected) as urls_expected,
  max(finished_at) as last_finished_at,
  (array_remove(array_agg(error order by created_at desc), null))[1] as last_error
from public.sweep_runs
where created_at >= current_date
  and source = 'loopnet'
group by county;

comment on view public.v_sweep_runs_today is
  'Per-county result of the LIVE sweep today (source=loopnet). A county missing from this view '
  'did not run. SUCCEEDED with 0 items counts as failed -- that is what a LoopNet block looks '
  'like. So does PARTIAL: urls_ok < urls_expected means the county lost one of its searches '
  'even though the run exited clean, which is how 14525 N Florida Ave stayed invisible.';

grant select on public.v_sweep_runs_today to authenticated, service_role;
