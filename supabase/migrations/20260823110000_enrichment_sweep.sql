-- Applied 2026-08-23 via MCP.
--
-- One call that drives every enricher to completion over the whole book, plus
-- the pg_cron pattern to run it. Each enricher already claims a slice of rows
-- where its own column is still null, so the sweep is just "keep calling until
-- nothing is left to claim" — idempotent, resumable, and safe to re-run after
-- the next parcel-polygon harvest adds rows.
--
-- Why cron and not a client loop: enriching ~120k parcels outlives the MCP's
-- 60s response window and the postgres role's statement_timeout. The land-book
-- backfill already established the pattern (20260821190000) — a cron session
-- can SET statement_timeout TO 0 for itself, and a one-off job unschedules
-- itself when it finishes.

begin;

create or replace function enrich_sweep(p_batch int default 2000, p_max_rounds int default 500)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'gis', 'extensions'
as $$
declare
  r int := 0;
  n int;
begin
  -- Counting progress inside the loop would mean five full scans of
  -- parcel_enrichment per round; the tallies are taken once, at the end.
  loop
    r := r + 1;
    n := coalesce((enrich_parcel_geometry(null, p_batch)->>'written')::int, 0)
       + coalesce((enrich_power_proximity(null, p_batch)->>'written')::int, 0)
       + coalesce((enrich_electric(null, p_batch)->>'written')::int, 0)
       + coalesce((enrich_gas(null, p_batch)->>'written')::int, 0)
       + coalesce((enrich_roads(null, p_batch)->>'written')::int, 0);
    exit when n = 0 or r >= p_max_rounds;
  end loop;

  -- score last, once the factors for this pass are in place
  loop
    n := coalesce((score_parcels(null, p_batch)->>'scored')::int, 0);
    exit when n = 0;
  end loop;

  return jsonb_build_object(
    'rounds', r,
    'geometry',     (select count(*) from parcel_enrichment where parcel_width_ft is not null),
    'power_nearby', (select count(*) from parcel_enrichment where nearest_powered_parcel_ft is not null),
    'electric',     (select count(*) from parcel_enrichment where substation_dist_ft is not null),
    'gas',          (select count(*) from parcel_enrichment where gas_transmission_dist_ft is not null),
    'roads',        (select count(*) from parcel_enrichment where interchange_mi is not null),
    'scored', (select count(*) from parcel_enrichment where scored_at is not null),
    'published', (select count(*) from parcel_enrichment where suitability_score is not null));
end $$;

comment on function enrich_sweep(int, int) is
  'Drive every enricher plus the scorer to completion over the whole book, batch at a '
  'time. Idempotent — each enricher only claims rows where its own column is still '
  'null, so re-running after a new parcel harvest picks up exactly the new parcels. '
  'Run it from pg_cron with statement_timeout 0; it outlives every client path.';

revoke all on function enrich_sweep(int, int) from public, anon;
grant execute on function enrich_sweep(int, int) to service_role, authenticated;

-- The one-off runner, scheduled 2026-08-23. It ticks every minute, takes a TRY
-- lock so a tick landing mid-sweep returns instead of queueing, and unschedules
-- itself once no parcel is left unenriched. Re-create it after any new parcel
-- polygon harvest.
--
--   select cron.schedule('enrich_sweep_once', '* * * * *', $j$
--     do $$
--     begin
--       if not pg_try_advisory_xact_lock(778811) then return; end if;
--       set local statement_timeout to 0;
--       if exists (select 1 from gis.parcels gp
--                  left join parcel_enrichment pe on pe.property_id = gp.property_id
--                  where pe.interchange_mi is null limit 1) then
--         perform enrich_sweep(1000, 500);
--       else
--         perform cron.unschedule('enrich_sweep_once');
--       end if;
--     end $$;
--   $j$);

commit;
