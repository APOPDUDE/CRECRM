-- n8n-owned daily market refresh (replaces pg_cron job 2, unscheduled 2026-08-26).
--
-- Why: job 2 silently stopped running 08-24/08-25 — dropped from pg_cron's
-- in-memory job list until an unrelated cron.job write (our alter_job on job 4)
-- made the scheduler reload and it resumed. A fixed jobid can wedge invisibly.
--
-- Mechanism: n8n workflow "CRE CRM · Market refresh kick (daily)" (12:30 ET,
-- id eekdcLE5jmAVudlW) POSTs rest/v1/rpc/kick_market_refresh with the service
-- key. The RPC is instant (fits service_role's 8s statement_timeout): it
-- cron.schedules a one-off 'market-refresh-once' two minutes out, which runs
-- both refreshes as postgres under a 10min timeout and unschedules itself in
-- the same command. Fresh job name+id every day = a wedged job can never block
-- future runs, and a failed kick surfaces as a failed n8n execution.
-- The cron expression matches exactly one minute-of-day, and the job removes
-- itself at the end of its first run, so it fires exactly once.

create or replace function public.kick_market_refresh()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_when timestamp := timezone('UTC', now()) + interval '2 minutes';
  v_cron text := format('%s %s * * *', extract(minute from v_when)::int, extract(hour from v_when)::int);
begin
  perform cron.schedule('market-refresh-once', v_cron,
    $job$set statement_timeout = '10min'; select public.refresh_property_market_position(); select public.refresh_county_market_stats(); select cron.unschedule('market-refresh-once');$job$);
  return 'market-refresh-once scheduled at ' || v_cron || ' UTC';
end $$;

revoke execute on function public.kick_market_refresh() from public, anon, authenticated;
grant execute on function public.kick_market_refresh() to service_role;
