-- 0050: the anon-grant cleanup sweep (Alex, 2026-08-31 — "go on the cleanup sweep").
-- Before this, all 56 SECURITY DEFINER functions in public carried EXECUTE for PUBLIC and
-- anon — with the anon key shipping in every browser, each was effectively a public
-- endpoint (RLS does not apply inside definer fns). Caller evidence gathered first
-- (context/supabase-audit-2026-08-31.md — sweep section):
--   · all 44 n8n RPC nodes use the service-role credential (zero raw-apikey headers)
--   · every edge fn (ghl-verify, bulk-load, …) uses SUPABASE_SERVICE_ROLE_KEY internally
--   · the Mac import scripts mint a claude-check JWT → they run as authenticated
--   · the frontend runs as authenticated
--   · pg_depend: no constraint/index/default/view evaluates any revoked fn
-- After: anon can execute exactly ONE definer fn — the PostgREST pre-request hook, which
-- every request in every role must be able to run.

-- ── A · the pgrst.db_pre_request hook (KEEPS anon by necessity) ─────────────
-- pgrst.db_pre_request = public.va_guard_pre_request on the authenticator role:
-- PostgREST invokes it as the request's role for EVERY request, including anon ones.
-- Revoking anon here would 500 the whole API. The advisor will keep flagging this one
-- fn — that is the documented, load-bearing exception.
revoke all on function va_guard_pre_request() from public;
grant execute on function va_guard_pre_request() to anon, authenticated, service_role;

-- ── B · trigger functions (EXECUTE is never checked when a trigger fires) ───
revoke all on function adopt_orphan_communications() from public, anon, authenticated;
revoke all on function comps_link_tenant_company() from public, anon, authenticated;
revoke all on function outreach_bridge_verified_contact() from public, anon, authenticated;
revoke all on function phone_suppressions_block_pending() from public, anon, authenticated;
revoke all on function push_manual_note_to_ghl() from public, anon, authenticated;
revoke all on function push_tags_to_ghl() from public, anon, authenticated;
revoke all on function set_owner_company_from_name() from public, anon, authenticated;
revoke all on function text_messages_inbound_intake() from public, anon, authenticated;
revoke all on function text_messages_outbound_gate() from public, anon, authenticated;

-- ── C · authenticated callers exist (frontend, VA console, Mac scripts, RLS) ─
-- Frontend .rpc() calls / VA texting console / claude-check JWT scripts / policies.
revoke all on function estimate_property_value(uuid, uuid[]) from public, anon;
grant execute on function estimate_property_value(uuid, uuid[]) to authenticated, service_role;
revoke all on function import_outreach_targets(jsonb) from public, anon;
grant execute on function import_outreach_targets(jsonb) to authenticated, service_role;
revoke all on function outreach_audience(jsonb) from public, anon;
grant execute on function outreach_audience(jsonb) to authenticated, service_role;
revoke all on function outreach_call_audience(jsonb) from public, anon;
grant execute on function outreach_call_audience(jsonb) to authenticated, service_role;
revoke all on function outreach_mail_audience(jsonb) from public, anon;
grant execute on function outreach_mail_audience(jsonb) to authenticated, service_role;
revoke all on function property_last_sales() from public, anon;
grant execute on function property_last_sales() to authenticated, service_role;
revoke all on function va_approve_send(uuid) from public, anon;
grant execute on function va_approve_send(uuid) to authenticated, service_role;
revoke all on function va_confirm_owner(text, uuid, text, text) from public, anon;
grant execute on function va_confirm_owner(text, uuid, text, text) to authenticated, service_role;
revoke all on function va_send_reply(text, text) from public, anon;
grant execute on function va_send_reply(text, text) to authenticated, service_role;
revoke all on function va_not_interested(text) from public, anon;
grant execute on function va_not_interested(text) to authenticated, service_role;
revoke all on function va_wrong_person(text) from public, anon;
grant execute on function va_wrong_person(text) to authenticated, service_role;
revoke all on function va_thread_context(text) from public, anon;
grant execute on function va_thread_context(text) to authenticated, service_role;
revoke all on function recent_touches(text) from public, anon;
grant execute on function recent_touches(text) to authenticated, service_role;
revoke all on function is_va() from public, anon;
grant execute on function is_va() to authenticated, service_role;
revoke all on function import_usable_acres(jsonb, numeric) from public, anon;
grant execute on function import_usable_acres(jsonb, numeric) to authenticated, service_role;
revoke all on function import_county_lowlands(jsonb) from public, anon;
grant execute on function import_county_lowlands(jsonb) to authenticated, service_role;
revoke all on function import_county_building_data(jsonb) from public, anon;
grant execute on function import_county_building_data(jsonb) to authenticated, service_role;

-- ── D · machine-only (n8n service cred, edge fns' service key, pg_cron) ─────
revoke all on function apply_ghl_tag(jsonb) from public, anon, authenticated;
grant execute on function apply_ghl_tag(jsonb) to service_role;
revoke all on function apply_ghl_tag_set(jsonb) from public, anon, authenticated;
grant execute on function apply_ghl_tag_set(jsonb) to service_role;
revoke all on function apply_zoning_map() from public, anon, authenticated;
grant execute on function apply_zoning_map() to service_role;
revoke all on function claim_text_sends(integer) from public, anon, authenticated;
grant execute on function claim_text_sends(integer) to service_role;
revoke all on function ghl_history_note_payload() from public, anon, authenticated;
grant execute on function ghl_history_note_payload() to service_role;
revoke all on function ghl_touch_verified_contact(jsonb) from public, anon, authenticated;
grant execute on function ghl_touch_verified_contact(jsonb) to service_role;
revoke all on function import_ghl_texts(jsonb) from public, anon, authenticated;
grant execute on function import_ghl_texts(jsonb) to service_role;
revoke all on function import_lease_comps(jsonb) from public, anon, authenticated;
grant execute on function import_lease_comps(jsonb) to service_role;
revoke all on function import_owner_addresses(jsonb) from public, anon, authenticated;
grant execute on function import_owner_addresses(jsonb) to service_role;
revoke all on function import_zoning(jsonb) from public, anon, authenticated;
grant execute on function import_zoning(jsonb) to service_role;
revoke all on function ingest_blooio_event(jsonb) from public, anon, authenticated;
grant execute on function ingest_blooio_event(jsonb) to service_role;
revoke all on function ingest_scrub_result(jsonb) from public, anon, authenticated;
grant execute on function ingest_scrub_result(jsonb) to service_role;
revoke all on function outreach_ghl_mark(jsonb) from public, anon, authenticated;
grant execute on function outreach_ghl_mark(jsonb) to service_role;
revoke all on function outreach_ghl_push_rows(text) from public, anon, authenticated;
grant execute on function outreach_ghl_push_rows(text) to service_role;
revoke all on function outreach_list_suppressed(text) from public, anon, authenticated;
grant execute on function outreach_list_suppressed(text) to service_role;
revoke all on function outreach_mark_wrong_number(jsonb) from public, anon, authenticated;
grant execute on function outreach_mark_wrong_number(jsonb) to service_role;
revoke all on function phone_e164(text) from public, anon, authenticated;
grant execute on function phone_e164(text) to service_role;
revoke all on function phone_is_suppressed(text) from public, anon, authenticated;
grant execute on function phone_is_suppressed(text) to service_role;
revoke all on function record_market_listings_for_known(jsonb) from public, anon, authenticated;
grant execute on function record_market_listings_for_known(jsonb) to service_role;
revoke all on function record_text_send_result(jsonb) from public, anon, authenticated;
grant execute on function record_text_send_result(jsonb) to service_role;
revoke all on function refresh_county_market_stats() from public, anon, authenticated;
grant execute on function refresh_county_market_stats() to service_role;
revoke all on function refresh_derived_property_tags() from public, anon, authenticated;
grant execute on function refresh_derived_property_tags() to service_role;
revoke all on function refresh_property_market_position() from public, anon, authenticated;
grant execute on function refresh_property_market_position() to service_role;
revoke all on function scrub_candidates(integer) from public, anon, authenticated;
grant execute on function scrub_candidates(integer) to service_role;
revoke all on function sweep_finalize_off_market(text[], integer) from public, anon, authenticated;
grant execute on function sweep_finalize_off_market(text[], integer) to service_role;
revoke all on function sweep_log_run(text, text, text, text, text, text, text, text, integer, integer, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function sweep_log_run(text, text, text, text, text, text, text, text, integer, integer, text, timestamptz, timestamptz) to service_role;
revoke all on function sweep_log_run(text, text, text, text, text, text, text, text, integer, integer, text, timestamptz, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function sweep_log_run(text, text, text, text, text, text, text, text, integer, integer, text, timestamptz, timestamptz, integer, integer) to service_role;
revoke all on function texting_quiet_ok(text) from public, anon, authenticated;
grant execute on function texting_quiet_ok(text) to service_role;
revoke all on function texting_send_allowed(text, boolean) from public, anon, authenticated;
grant execute on function texting_send_allowed(text, boolean) to service_role;
