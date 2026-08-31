-- 0046: market_monitor_health — one cheap aggregate for the n8n watchdog.
-- Returns {source: seconds_since_last_seen}. The watchdog compares against per-source
-- staleness thresholds (a frozen feed AND a dead workflow both show up as age).

create or replace function market_monitor_health()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(s.source, extract(epoch from (now() - s.max_seen))::bigint),
    '{}'::jsonb)
  from (
    select source, max(last_seen_at) as max_seen
    from market_events
    group by source
  ) s;
$$;

revoke all on function market_monitor_health() from public, anon;
grant execute on function market_monitor_health() to authenticated, service_role;
