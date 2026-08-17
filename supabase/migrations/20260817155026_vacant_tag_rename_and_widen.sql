-- Alex 2026-08-17: call the tag plain `vacant` and tag land too — "I can search a min of 1 sqft if
-- I want something that isn't land". So the tag now means exactly what the county/listing text says
-- (this parcel is vacant), and improved-vs-land is a size filter at query time, not a tagging rule.
-- Applied with properties_push_tags DISABLED (see 20260817151831 header), then re-enabled.
-- Result: `vacant` 174 (52 with a building, 122 land) — Hillsborough 146 · Polk 10 · Pinellas 7 ·
-- Sarasota 4 · Pasco 3 · Charlotte 3 · Osceola 1. `vacant building` retired to 0.
-- `owner occupier` unchanged at 2,937 = 2,738 mail-match + 199 DBA-only.
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
  -- owner occupier — two independent signals, unioned:
  --   (a) the owner receives mail AT the property (all six counties, incl. Polk). PO boxes excluded;
  --       street-line vs street-line via normalize_street. MISSES corporate-HQ / PO-box mailers
  --       (Old Dominion, Jenkins Nissan) — a floor, never a filter that excludes.
  --   (b) the county DBA business name matches the owner of record (Hillsborough only — the only
  --       county whose payload carries a `dba` key; see reference-county-dba-title).
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

  -- vacant — the county's occupancy note (or a listing headline) says so. Land included on purpose.
  -- Perishable: the county DBA is never refreshed, so this is a lead to verify, not a fact.
  update properties p
  set tags = (select array_agg(distinct t order by t) from unnest(coalesce(p.tags, '{}') || array['vacant']) t)
  where not ('vacant' = any(coalesce(p.tags, '{}')))
    and p.title ilike '%vacant%';
  get diagnostics n_vac = row_count;

  return jsonb_build_object('owner_occupier_added', n_oo, 'vacant_added', n_vac);
end
$$;
