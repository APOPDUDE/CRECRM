-- =========================================================================
-- Static-property column drop, Step 6: physically drop the 5 variable columns
-- and the trigger that kept them synced. Pricing/space now live ONLY on the
-- comps time-series (keyed by property_id); readers go through
-- v_property_current_asking (matching, market views, frontend).
--
-- DEPLOY COUPLING: the prior (deployed) frontend's MATCH_SELECT / SUGGESTION_SELECT
-- / off-market select name these columns explicitly, so this migration MUST be
-- applied together with deploying the repointed frontend, or those reads 400.
-- =========================================================================

drop trigger if exists comps_sync_asking_cache on public.comps;
drop function if exists public.sync_property_asking_cache();

alter table public.properties
  drop column if exists asking_rate_psf,
  drop column if exists asking_price,
  drop column if exists cap_rate_pct,
  drop column if exists space_sf_min,
  drop column if exists space_sf_max;
