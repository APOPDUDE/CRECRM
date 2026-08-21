-- Applied 2026-08-21 via MCP.
--
-- Alex, 2026-08-21: "I see there are a lot of new tables of roll_back etc —
-- remember our principle of minimizing tables so the database is easy for an
-- AI model to query." Correct: these 30 are one-time pre-image snapshots from
-- the Aug 12-19 merge/purge/backfill work (the _rollback_* convention). Every
-- backfill they insured has been live and verified for days; the rollback
-- window is closed, and pg_depend shows nothing references them. Same cleanup
-- as 20260815025822 (drop_rollback_replay_scratch), one sprint later.
--
-- KEPT: email_leads_archive — that one is the deliberate historical archive
-- from the email_leads retirement (20260817), not scratch.
--
-- Norm going forward: _<purpose>_<yyyymmdd> snapshots are disposable by the
-- next cleanup pass once their backfill has survived a few days.

begin;

drop table if exists
  _bounce_purge_set_20260815,
  _floating_purge_20260816,
  _fp_valuation_post_20260819,
  _fp_valuation_pre_20260819,
  _gov_purge_set_20260816,
  _homes_purge2_set_20260816,
  _homes_purge_set_20260815,
  _linktrail_purge_set_20260815,
  _merge_plan_20260814,
  _pin_adult_20260815,
  _purge2_set_20260815,
  _purge_set_20260815,
  _response_audit_20260815,
  _restore_set_20260815,
  _rollback_1845_university_20260818,
  _rollback_comms_purge_20260815,
  _rollback_companies_premerge_20260815,
  _rollback_contact_merge_20260814,
  _rollback_contact_purge_20260815,
  _rollback_contacts_unverify_20260818,
  _rollback_contacts_verified_20260812,
  _rollback_homes_purge_20260815,
  _rollback_owner_contacts_final_20260815,
  _rollback_owners_final_20260815,
  _rollback_owners_premerge_20260815,
  _rollback_parcel_fix_20260818,
  _rollback_property_ghost_20260817,
  _rollback_property_tags_20260817,
  _rollback_property_tags_20260817b,
  _rollback_response_unverify_20260815;

commit;
