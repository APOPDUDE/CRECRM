-- Perf: RLS initplan rewrite + parcel_enrichment read indexes (2026-08-26)
--
-- 1) Every va_deny policy called is_va() PER ROW. is_va() is a STABLE
--    SECURITY DEFINER fn reading auth.jwt(), ~8-500us/call depending on cache.
--    Measured: identical bucket count on properties = 68ms as authenticated
--    vs 2ms as postgres (34x). The War Room owner-context bucket spent ~5.5s
--    of 6.5s in is_va() calls (33k calls for 1000 rows via lateral joins).
--    Wrapping in a scalar subselect makes the planner run it ONCE per query
--    (InitPlan). Semantics identical: same boolean, same jwt, evaluated at
--    query start. This is the standard Supabase auth_rls_initplan fix; the
--    Supabase linter cannot see it because auth.jwt() is hidden inside the
--    is_va() wrapper.
--    NOTE for future policies: always write ((select ...)) around any
--    function call in USING / WITH CHECK.
--
-- 2) Two partial indexes on parcel_enrichment:
--    - score_read: the War Room scores fetch (property_id, suitability_score
--      where not null) seq-scanned 339MB per page (1.1s x ~950 calls/38h).
--      Covering partial index -> index-only scan.
--    - score_todo: score_parcels()' todo scan (scored_at is null or
--      updated_at > scored_at) has no index; every n8n tick pays a full
--      seq scan even when there is no work. Matters again at county
--      re-import time when 100k rows get dirtied.

-- ---------- RLS initplan rewrite (60 policies) ----------

alter policy area_code_timezones_va_deny on public.area_code_timezones using ((select not is_va())) with check ((select not is_va()));
alter policy buyer_intakes_va_deny on public.buyer_intakes using ((select not is_va())) with check ((select not is_va()));
alter policy clients_va_deny on public.clients using ((select not is_va())) with check ((select not is_va()));
alter policy communications_va_deny on public.communications using ((select not is_va())) with check ((select not is_va()));
alter policy companies_va_deny on public.companies using ((select not is_va())) with check ((select not is_va()));
alter policy comps_va_deny on public.comps using ((select not is_va())) with check ((select not is_va()));
alter policy contacts_va_deny on public.contacts using ((select not is_va())) with check ((select not is_va()));
alter policy county_land_rents_va_deny on public.county_land_rents using ((select not is_va())) with check ((select not is_va()));
alter policy county_lookup_va_deny on public.county_lookup using ((select not is_va())) with check ((select not is_va()));
alter policy county_market_stats_va_deny on public.county_market_stats using ((select not is_va())) with check ((select not is_va()));
alter policy county_tax_rates_va_deny on public.county_tax_rates using ((select not is_va())) with check ((select not is_va()));
alter policy deal_flags_va_deny on public.deal_flags using ((select not is_va())) with check ((select not is_va()));
alter policy dor_codes_va_deny on public.dor_codes using ((select not is_va())) with check ((select not is_va()));
alter policy email_sequence_templates_va_deny on public.email_sequence_templates using ((select not is_va())) with check ((select not is_va()));
alter policy files_va_deny on public.files using ((select not is_va())) with check ((select not is_va()));
alter policy listing_parcels_va_deny on public.listing_parcels using ((select not is_va())) with check ((select not is_va()));
alter policy listings_va_deny on public.listings using ((select not is_va())) with check ((select not is_va()));
alter policy news_items_va_deny on public.news_items using ((select not is_va())) with check ((select not is_va()));
alter policy notes_va_deny on public.notes using ((select not is_va())) with check ((select not is_va()));
alter policy outreach_calls_va_deny on public.outreach_calls using ((select not is_va())) with check ((select not is_va()));
alter policy outreach_email_va_deny on public.outreach_email using ((select not is_va())) with check ((select not is_va()));
alter policy outreach_exports_va_deny on public.outreach_exports using ((select not is_va())) with check ((select not is_va()));
alter policy outreach_mail_va_deny on public.outreach_mail using ((select not is_va())) with check ((select not is_va()));
alter policy outreach_targets_va_deny on public.outreach_targets using ((select not is_va())) with check ((select not is_va()));
alter policy outreach_texts_va_deny_delete on public.outreach_texts using ((select not is_va()));
alter policy outreach_texts_va_deny_insert on public.outreach_texts with check ((select not is_va()));
alter policy outreach_texts_va_deny_update on public.outreach_texts using ((select not is_va())) with check ((select not is_va()));
alter policy phone_scrubs_va_deny on public.phone_scrubs using ((select not is_va())) with check ((select not is_va()));
alter policy phone_suppressions_va_deny_delete on public.phone_suppressions using ((select not is_va()));
alter policy phone_suppressions_va_deny_insert on public.phone_suppressions with check ((select not is_va()));
alter policy phone_suppressions_va_deny_update on public.phone_suppressions using ((select not is_va())) with check ((select not is_va()));
alter policy properties_va_deny on public.properties using ((select not is_va())) with check ((select not is_va()));
alter policy property_market_position_va_deny on public.property_market_position using ((select not is_va())) with check ((select not is_va()));
alter policy property_owner_rollup_va_deny on public.property_owner_rollup using ((select not is_va())) with check ((select not is_va()));
alter policy prospect_properties_va_deny on public.prospect_properties using ((select not is_va())) with check ((select not is_va()));
alter policy prospects_va_deny on public.prospects using ((select not is_va())) with check ((select not is_va()));
alter policy pursuit_units_va_deny on public.pursuit_units using ((select not is_va())) with check ((select not is_va()));
alter policy pursuits_va_deny on public.pursuits using ((select not is_va())) with check ((select not is_va()));
alter policy send_authorizations_va_deny on public.send_authorizations using ((select not is_va())) with check ((select not is_va()));
alter policy suggestions_va_deny on public.suggestions using ((select not is_va())) with check ((select not is_va()));
alter policy sweep_meta_va_deny on public.sweep_meta using ((select not is_va())) with check ((select not is_va()));
alter policy tasks_va_deny on public.tasks using ((select not is_va())) with check ((select not is_va()));
alter policy text_campaigns_va_deny_delete on public.text_campaigns using ((select not is_va()));
alter policy text_campaigns_va_deny_insert on public.text_campaigns with check ((select not is_va()));
alter policy text_campaigns_va_deny_update on public.text_campaigns using ((select not is_va())) with check ((select not is_va()));
alter policy text_messages_va_deny_delete on public.text_messages using ((select not is_va()));
alter policy text_messages_va_deny_insert on public.text_messages with check ((select not is_va()));
alter policy text_messages_va_deny_update on public.text_messages using ((select not is_va())) with check ((select not is_va()));
alter policy text_sends_va_deny_delete on public.text_sends using ((select not is_va()));
alter policy text_sends_va_deny_insert on public.text_sends with check ((select not is_va()));
alter policy text_sends_va_deny_update on public.text_sends using ((select not is_va())) with check ((select not is_va()));
alter policy texting_settings_va_deny_delete on public.texting_settings using ((select not is_va()));
alter policy texting_settings_va_deny_insert on public.texting_settings with check ((select not is_va()));
alter policy texting_settings_va_deny_update on public.texting_settings using ((select not is_va())) with check ((select not is_va()));
alter policy units_va_deny on public.units using ((select not is_va())) with check ((select not is_va()));
alter policy user_prefs_va_deny on public.user_prefs using ((select not is_va())) with check ((select not is_va()));
alter policy valuation_comp_exclusions_va_deny on public.valuation_comp_exclusions using ((select not is_va())) with check ((select not is_va()));
alter policy valuation_params_va_deny on public.valuation_params using ((select not is_va())) with check ((select not is_va()));
alter policy zoning_code_map_va_deny on public.zoning_code_map using ((select not is_va())) with check ((select not is_va()));
alter policy storage_objects_va_deny on storage.objects using ((select not is_va())) with check ((select not is_va()));

-- ---------- parcel_enrichment read indexes ----------
-- (applied out-of-band with CREATE INDEX CONCURRENTLY on 2026-08-26;
--  IF NOT EXISTS keeps this migration idempotent)

create index if not exists parcel_enrichment_score_read_idx
  on public.parcel_enrichment (property_id)
  include (suitability_score)
  where suitability_score is not null;

create index if not exists parcel_enrichment_score_todo_idx
  on public.parcel_enrichment (property_id)
  where scored_at is null or updated_at > scored_at;
