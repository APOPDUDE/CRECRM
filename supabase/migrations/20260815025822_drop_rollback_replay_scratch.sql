-- Audit item 1: the Jul-08 sweep-replay pre-image, 37 days settled, zero pg_depend dependencies.
-- The other snapshots (_rollback_contacts_verified_20260812, dup_note_cleanup_20260814,
-- _rollback_contact_merge_20260814, _merge_plan_20260814) are KEPT deliberately.
drop table if exists _rollback_replay_20260708;
