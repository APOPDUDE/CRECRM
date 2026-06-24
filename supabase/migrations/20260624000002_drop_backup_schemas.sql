-- Audit cleanup (redundancy): drop the two pre-redesign snapshot schemas.
-- backup_predesign (11 tables: old matches/tenant_reps/lease_comps/match_suggestions shapes)
-- and backup_propreset (3 tables) were taken before the AI-native redesign (migrations 0027-0045)
-- and the static-property column drop. Verified zero external dependents: no views, FKs, or
-- functions outside the backup schemas reference them; their table shapes no longer exist live.
-- ~7.2 MB reclaimed. Irreversible, but the migrated data lives in the current tables
-- (pursuits/clients/comps). CASCADE is safe given the verified zero external dependency count.

drop schema if exists backup_predesign cascade;
drop schema if exists backup_propreset cascade;
