-- Audit item 6 [35]: functions with zero callers in app code, n8n workflows, triggers, views,
-- or other functions, whose one-off purpose is complete or superseded. Git history is the archive.
-- Kept despite no static caller (bulk-pipe runbooks): import_county_parcels, import_usable_acres,
-- import_county_lowlands, import_county_building_data, import_lease_comps, import_terrakotta_batch,
-- import_hubspot_batch, import_owner_addresses, relink_owner_contacts, link_appraiser_owner_entities.
-- buyers_covering_point deliberately NOT dropped (adopt-or-drop decision pending).
drop function if exists create_property_and_listing(uuid, text, deal_type, text, text, property_kind, uuid, uuid, lead_source, numeric, numeric);
drop function if exists import_sale_history(jsonb);
drop function if exists match_addresses(jsonb);
drop function if exists pending_geocode(jsonb);
drop function if exists set_property_coords(jsonb);
drop function if exists import_email_leads(jsonb);
drop function if exists import_email_threads(jsonb);
drop function if exists import_owner_email_leads(jsonb);
drop function if exists attach_tenant_companies(jsonb);
drop function if exists enrich_tenant_companies(jsonb);
drop function if exists classify_owner_kind(text);
