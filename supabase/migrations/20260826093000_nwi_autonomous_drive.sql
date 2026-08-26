-- Applied 2026-08-26 via MCP.
--
-- The NWI harvest kept dying with the agent session's container (tile 52 of
-- 340 after two nights of babysitting). The database now drives it ITSELF: a
-- pg_cron tick fires drain-mode calls at the harvest-gis edge function via
-- pg_net — one POST drains one whole 0.1-degree tile inside a single edge
-- invocation (harvest-gis v6, body {drain:true}) — and advances a counter in
-- gis.nwi_drive. Tiles run TWICE (idx 0..679, tile = idx % 340): the posts are
-- fire-and-forget, so a tile that failed in pass one is refilled by pass two's
-- idempotent upserts.
--
-- When the tiles finish, the SAME job drains enrich_wetlands (800 parcels a
-- tick), then runs bounded score passes, then unschedules itself. Each tick is
-- light — four async posts or one enrichment batch — so it runs safely through
-- Alex's workday, unlike the whole-book passes that saturated the box.
--
-- The anon key in the job command is the PUBLISHABLE key (same one the browser
-- bundle ships), present only to satisfy the edge function's JWT check.
--
-- (The cron.schedule call lives in the applied migration; re-creating it after
-- a restore: see the nwi_drive job body in cron.job.)

create table if not exists gis.nwi_drive (
  id boolean primary key default true check (id),
  next_idx int not null default 0
);
insert into gis.nwi_drive (next_idx) values (0) on conflict do nothing;

comment on table gis.nwi_drive is
  'Cursor for the self-driving NWI tile harvest (cron job nwi_drive): idx 0..679, '
  'tile = idx % 340 over the 20x17 grid of 0.1-degree AOI tiles, two full passes. '
  'The job flips to enrich_wetlands drain + score passes past 680, then retires.';
