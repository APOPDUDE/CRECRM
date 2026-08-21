-- sweep_runs: one row per actor run, so "which counties failed today" is a query.
--
-- Why (Alex, 2026-08-21). Diagnosing the 08-16..08-21 outage took a day of Apify-API
-- forensics because the database records nothing about a run. last_seen_in_sweep is a single
-- overwritten column: a county that failed looks exactly like a county nobody scheduled, and
-- the actor's own error text ("HTTP 401 ... Refresh the scrapingbee key" -- the line that
-- named the whole problem) never reached Postgres at all.
--
-- n8n writes one row per startUrl run: 7 counties x 4 URLs = 28 rows a day.

create table if not exists public.sweep_runs (
  id            uuid primary key default gen_random_uuid(),
  source        text not null default 'loopnet',
  actor_id      text,
  run_id        text,
  county        text,
  property_type text,
  deal_type     text,
  start_url     text,
  status        text not null,
  item_count    integer,
  imported      integer,
  error         text,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint sweep_runs_run_uq unique (source, run_id),
  constraint sweep_runs_deal_type_known
    check (deal_type is null or deal_type in ('lease','sale'))
);

create index if not exists sweep_runs_created_idx on public.sweep_runs (created_at desc);
create index if not exists sweep_runs_county_idx  on public.sweep_runs (county, created_at desc);
create index if not exists sweep_runs_failed_idx  on public.sweep_runs (created_at desc)
  where status <> 'SUCCEEDED';

comment on table public.sweep_runs is
  'One row per Apify sweep run (one start URL). status/error come straight from the actor, so '
  'a provider outage is visible in SQL instead of only in Apify''s run log.';
comment on column public.sweep_runs.item_count is
  'Rows the actor returned. imported is how many survived the mapper''s industrial/land filter.';

alter table public.sweep_runs enable row level security;

drop policy if exists sweep_runs_auth_all on public.sweep_runs;
create policy sweep_runs_auth_all on public.sweep_runs
  for all to authenticated using (true) with check (true);

grant select, insert, update on public.sweep_runs to authenticated, service_role;

-- One call from n8n per run, idempotent on (source, run_id) so a retry or the Sun+Wed
-- backup pull re-stating the same run updates it rather than duplicating it.
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
  p_finished_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  insert into sweep_runs (source, actor_id, run_id, county, property_type, deal_type,
                          start_url, status, item_count, imported, error, started_at, finished_at)
  values (coalesce(p_source,'loopnet'), p_actor_id, p_run_id, p_county, p_property_type,
          nullif(p_deal_type,''), p_start_url, p_status, p_item_count, p_imported,
          nullif(p_error,''), p_started_at, p_finished_at)
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
    finished_at   = coalesce(excluded.finished_at, sweep_runs.finished_at)
  returning id into v_id;
  return v_id;
end $function$;

grant execute on function public.sweep_log_run(text,text,text,text,text,text,text,text,integer,integer,text,timestamptz,timestamptz)
  to authenticated, service_role;

-- The standing question, answered in one read: did every county report in today?
create or replace view public.v_sweep_runs_today
with (security_invoker = true) as
select
  county,
  count(*) as runs,
  count(*) filter (where status = 'SUCCEEDED') as succeeded,
  count(*) filter (where status <> 'SUCCEEDED') as failed,
  sum(item_count) as items,
  sum(imported) as imported,
  max(finished_at) as last_finished_at,
  (array_remove(array_agg(error order by created_at desc), null))[1] as last_error
from public.sweep_runs
where created_at >= current_date
group by county;

comment on view public.v_sweep_runs_today is
  'Per-county sweep result for today. A county missing from this view did not run at all -- '
  'which the old last_seen_in_sweep column could never distinguish from a failure.';

grant select on public.v_sweep_runs_today to authenticated, service_role;
