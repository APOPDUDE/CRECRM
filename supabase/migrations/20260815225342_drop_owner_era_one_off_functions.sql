-- STAGE 2b end-game (2g): the owners-era one-offs retire. Git history is the archive;
-- each is one create-or-replace away from resurrection.
--   relink_owner_contacts        — owner_contacts rebuild helper; table is dropping
--   link_appraiser_owner_entities— the owners backfill door; owners is dropping
--   import_terrakotta_evidence_upgrade — wrote owner_contacts confidence; retired
--   import_owner_addresses       — owner_import path that minted the mailing-address ghosts

drop function if exists public.relink_owner_contacts(jsonb);
drop function if exists public.link_appraiser_owner_entities(text);
drop function if exists public.import_terrakotta_evidence_upgrade(uuid);
drop function if exists public.import_owner_addresses(jsonb);
