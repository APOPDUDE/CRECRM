-- Two evidence-derived property tags, re-runnable (new county imports get tagged on the next call).
-- Alex's call 2026-08-17: put the owner-occupier + vacancy signals on properties.tags rather than
-- leaving them as read-time flags. 'owner occupier' is the EXISTING tag (55 human-evidenced rows,
-- and apply_ghl_tag_set already speaks it both ways) — we add to it, never rename it.
--
-- owner occupier — two independent signals, unioned:
--   (a) the owner receives mail AT the property (works in all six counties, incl. Polk);
--       PO boxes excluded, and the compare is street-line vs street-line via normalize_street.
--   (b) the county DBA business name matches the owner of record (Hillsborough only — that is the
--       only county whose payload carries a `dba` key; see reference-county-dba-title).
--   Signal (a) MISSES owner-occupiers who take mail at a corporate HQ or PO box (Old Dominion,
--   Jenkins Nissan) — this tag is a floor, never a filter that excludes.
-- vacant building — the county/listing text says vacant AND there is a building. Deliberately NOT
--   applied to land: every raw lot is "vacant", so the signal there is noise. Perishable — the
--   county DBA is never refreshed (same reference), so treat as a lead to verify.
--
-- BACKFILL NOTE: run it with `alter table properties disable trigger properties_push_tags;` around
-- the call. properties_push_tags posts to the n8n crm-tag-push webhook per changed row, so a 2,900
-- row backfill would spray GHL tag calls at every owner with a verified contact.
-- Applied 2026-08-17: owner occupier 55 -> 2,937 (Hillsborough 1,177 · Pinellas 857 · Polk 424 ·
-- Manatee 265 · Sarasota 156 · Pasco 57), vacant building 52. Zero pre-existing tags lost
-- (pre-image `_rollback_property_tags_20260817`).
create or replace function refresh_derived_property_tags()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_oo int := 0;
  n_vac int := 0;
begin
  update properties p
  set tags = (select array_agg(distinct t order by t) from unnest(coalesce(p.tags, '{}') || array['owner occupier']) t)
  where not ('owner occupier' = any(coalesce(p.tags, '{}')))
    and (
      (
        p.owner_mailing_address is not null
        and p.owner_mailing_address !~* '^\s*(p\.?\s*o\.?\s*box|post office)'
        and coalesce(p.site_address, p.address) is not null
        and length(coalesce(normalize_street(split_part(p.owner_mailing_address, ',', 1)), '')) > 5
        and normalize_street(coalesce(p.site_address, p.address))
            = normalize_street(split_part(p.owner_mailing_address, ',', 1))
      )
      or (
        p.source = 'county_appraiser' and p.title is not null and p.owner_name is not null
        and length(coalesce(normalize_owner_name(p.title), '')) > 6
        and (position(normalize_owner_name(p.title) in normalize_owner_name(p.owner_name)) > 0
             or position(normalize_owner_name(p.owner_name) in normalize_owner_name(p.title)) > 0)
      )
    );
  get diagnostics n_oo = row_count;

  update properties p
  set tags = (select array_agg(distinct t order by t) from unnest(coalesce(p.tags, '{}') || array['vacant building']) t)
  where not ('vacant building' = any(coalesce(p.tags, '{}')))
    and p.title ilike '%vacant%'
    and coalesce(p.gross_sf, 0) > 1000;
  get diagnostics n_vac = row_count;

  return jsonb_build_object('owner_occupier_added', n_oo, 'vacant_building_added', n_vac);
end
$$;
