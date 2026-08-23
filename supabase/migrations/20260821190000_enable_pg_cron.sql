-- Applied 2026-08-21 via MCP.
--
-- pg_cron: server-side job scheduler. Enabled for heavy maintenance that no
-- client path can wait for — the land-import backfill of refresh_land_book()
-- over the 127k-row book outlives both the MCP's 60s response window and the
-- postgres role's ~2min statement_timeout (a cron job session can SET
-- statement_timeout TO 0 for itself). One-off jobs schedule themselves every
-- minute and unschedule on success; recurring DB-side maintenance can live
-- here later (n8n stays the scheduler for anything needing HTTP).

create extension if not exists pg_cron;
