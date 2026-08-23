-- Applied 2026-08-22 via MCP.
--
-- Situs-address backfill for the land import's placeholder rows (Alex,
-- 2026-08-21: "we need addresses for skip tracing").
--
-- Where the addresses come from: the SAME Polk parcel layer the land import
-- already reads (Map_Property_Appraiser/MapServer/1). The original harvest
-- passed a: null for Polk on the belief that the layer "exposes no situs
-- address" (a comment inherited from enrich-appraiser). That was wrong — the
-- layer carries PROP_ADRNO / PROP_ADRDIR / PROP_ADRSTR / PROP_ADRSUF /
-- PROP_ADRSUF2 / PROP_UNITNO, and unlike an E911 address-point layer it
-- covers VACANT land. (Measured on our own placeholder parcels: ~45% yield a
-- street name or better; the remainder are DOR "Inaccessible tracts" —
-- landlocked, no road access, so no address exists to find. Polk's E911
-- Addresses layer was tested first and covered only 6%.)
--
-- WRITES site_address, NOT address. House convention (enrich-appraiser, and
-- every read path: v_map_property, useProperties, search_text) is that the
-- county situs lives in site_address and wins on display via
-- coalesce(site_address, address); `address` keeps the row's original source
-- value — here the 'Parcel <id>' placeholder. So the app immediately shows
-- "OLD GRADE RD" while provenance stays intact and nothing is overwritten.
--
-- Fill-null ONLY: an existing site_address (county-synced or human) always
-- wins. Deliberately does NOT touch city — properties_set_county derives
-- county FROM city, and an unmapped city would NULL the county (the guard the
-- land import already respects); Polk placeholder rows are already 100% zip
-- and 87% city populated anyway.
--
-- Set-based, not a per-row loop: the land import's loop-based RPC needed
-- 250-row pages to clear the statement timeout. This one joins on
-- properties_county_parcel_norm_idx (county, alnum parcel) and clears a
-- 2,000-row payload comfortably.

begin;

create or replace function import_situs_addresses(p jsonb) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_county text := p->>'county';
  v_received int;
  v_written int;
begin
  if v_county is null then
    return jsonb_build_object('error', 'county required');
  end if;

  create temp table _situs_in on commit drop as
  select lower(regexp_replace(r.parcel, '[^a-zA-Z0-9]', '', 'g')) as k,
         nullif(btrim(r.situs), '') as situs
  from jsonb_to_recordset(p->'rows') as r(parcel text, situs text)
  where nullif(btrim(coalesce(r.parcel, '')), '') is not null;

  select count(*) into v_received from _situs_in;

  -- one row per key: a county can hand back the same parcel twice
  delete from _situs_in a using _situs_in b
  where a.k = b.k and a.ctid > b.ctid;

  with upd as (
    update properties pr
    set site_address = i.situs,
        appraiser_data = coalesce(pr.appraiser_data, '{}'::jsonb)
          || jsonb_build_object('situs_source', 'county_parcel_layer'),
        appraiser_updated_at = now()
    from _situs_in i
    where pr.county = v_county
      and split_part(pr.parcel_key, '|', 1) = i.k
      and i.situs is not null
      and pr.site_address is null      -- fill-null only
    returning 1
  )
  select count(*) into v_written from upd;

  return jsonb_build_object('received', v_received, 'written', v_written);
end $$;

comment on function import_situs_addresses(jsonb) is
  'Backfill county situs addresses onto parcels whose site_address is null. Payload '
  '{county, rows:[{parcel, situs}]}. Writes site_address only (fill-null); never touches '
  'address (keeps the ''Parcel <id>'' placeholder as provenance) or city (the set_county '
  'trigger would re-derive county from it). Set-based; safe at ~2,000 rows/call.';

revoke all on function import_situs_addresses(jsonb) from public, anon;
grant execute on function import_situs_addresses(jsonb) to service_role, authenticated;

commit;
