-- 0049: drop the five scratch/archive tables (Alex, 2026-08-31 — "drop them").
-- Flagged by the audit (RLS-disabled + no PK, zero app references; locked read-only by
-- 0048 pending this decision). Row counts at drop time, for the record:
--   _fp_land_pre_20260829       48    land-valuation L1 before/after fingerprints (08-29)
--   _fp_land_post_20260829      48
--   _fp_land_subjects_20260829  48
--   dup_note_cleanup_20260814  441    note-dedupe worklist (08-14, work completed)
--   email_leads_archive      5,487    pre-outreach-spine audience (superseded 08-17;
--                                     the spine's outreach_targets is the living copy)

drop table _fp_land_pre_20260829;
drop table _fp_land_post_20260829;
drop table _fp_land_subjects_20260829;
drop table dup_note_cleanup_20260814;
drop table email_leads_archive;
