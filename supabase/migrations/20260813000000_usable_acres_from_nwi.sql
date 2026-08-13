-- Uplands: fill `usable_acres` from the National Wetlands Inventory.
--
-- The valuation already reads `coalesce(usable_acres, land_acres)`, so until now
-- every estimate has been pricing swamp at yard rates. This is the other half.
--
-- HOW THE NUMBER IS MADE (all of it offline, in DuckDB - see data/wetlands/):
--   1. Parcel polygon from the FDOR statewide cadastral layer, keyed by the NAL
--      PARCEL_ID that the base layer's `crm_cov2` crosswalk already resolved.
--      NOT by point-in-polygon on the CRM lat/lng - spot-checked, and 4211 W
--      Waters Ave landed inside its NEIGHBOUR's parcel, because the CRM
--      coordinate is a geocoded street point, not a parcel centroid.
--   2. USFWS NWI wetlands (FL_geodatabase_wetlands, 1.06M polygons).
--   3. Both layers are EPSG:5070 - NAD83 Albers, metres, EQUAL AREA - so acreage
--      is measured directly with no reprojection and no latitude distortion.
--   4. Wetland polygons are UNIONed before subtracting. NWI is mostly a
--      partition, but Riverine and Lake overlap other classes; summing them
--      would over-subtract and invent dry land that is not there.
--
-- WHAT GETS STORED IS A FRACTION APPLIED TO OUR OWN ACREAGE, not the raw upland
-- figure: `usable_acres = land_acres x (upland / parcel_area)`. The cadastral
-- polygon and the CRM's `land_acres` disagree slightly on many parcels, and the
-- CRM figure is the one the rest of the app trusts. Taking the ratio keeps the
-- measurement (which part is dry) while keeping our area of record.
--
-- Every NWI class counts as unusable - forested/emergent wetland, pond, riverine,
-- estuarine, lake. None of it takes a building or a trailer.

-- Provenance, so a re-run never silently overwrites a human, and so a stale fill
-- can be found and re-done when NWI or the cadastral layer is refreshed.
alter table properties add column if not exists usable_acres_source text;
alter table properties add column if not exists usable_acres_updated_at timestamptz;

comment on column properties.usable_acres is
  'Upland (non-wetland) acreage. Filled from USFWS NWI x the FDOR cadastral parcel polygon; see usable_acres_source. The valuation reads coalesce(usable_acres, land_acres), so a null here means the estimate is using TOTAL acreage and will overstate a wet parcel.';
comment on column properties.usable_acres_source is
  '''nwi'' = measured off the National Wetlands Inventory. ''manual'' = set by hand and never overwritten by the importer. Null = never filled.';

/**
 * Bulk-write measured uplands.
 *
 * p is [{property_id, upland_fraction, parcel_acres, wet_acres}, ...].
 *
 * Refuses to touch a row whose `usable_acres_source` is anything other than
 * 'nwi' or null - a hand-entered figure outranks a measurement.
 *
 * Also refuses when the cadastral polygon's area disagrees with our own
 * `land_acres` by more than p_area_tolerance: that is the signature of a
 * mis-matched parcel, and a wrong polygon would quietly write a wrong upland
 * fraction that nobody would ever question.
 */
create or replace function import_usable_acres(
  p jsonb,
  p_area_tolerance numeric default 0.25
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_updated int := 0;
  v_skipped_manual int := 0;
  v_skipped_area int := 0;
  v_skipped_missing int := 0;
begin
  with input as (
    select (r->>'property_id')::uuid            as property_id,
           (r->>'upland_fraction')::numeric     as frac,
           (r->>'parcel_acres')::numeric        as parcel_acres,
           (r->>'wet_acres')::numeric           as wet_acres
    from jsonb_array_elements(p) r
  ),
  judged as (
    select i.*, pr.land_acres, pr.usable_acres_source,
           case
             when pr.id is null then 'missing'
             when pr.usable_acres_source is not null
              and pr.usable_acres_source <> 'nwi' then 'manual'
             when pr.land_acres is null or pr.land_acres <= 0 then 'missing'
             when abs(i.parcel_acres - pr.land_acres) / pr.land_acres > p_area_tolerance then 'area'
             else 'ok'
           end as verdict
    from input i
    left join properties pr on pr.id = i.property_id
  ),
  applied as (
    update properties pr
       set usable_acres = least(pr.land_acres, round(pr.land_acres * j.frac, 2)),
           usable_acres_source = 'nwi',
           usable_acres_updated_at = now()
      from judged j
     where pr.id = j.property_id and j.verdict = 'ok'
    returning 1
  )
  select (select count(*) from applied),
         (select count(*) from judged where verdict = 'manual'),
         (select count(*) from judged where verdict = 'area'),
         (select count(*) from judged where verdict = 'missing')
    into v_updated, v_skipped_manual, v_skipped_area, v_skipped_missing;

  return jsonb_build_object(
    'updated', v_updated,
    'skipped_manual', v_skipped_manual,
    'skipped_area_mismatch', v_skipped_area,
    'skipped_missing', v_skipped_missing
  );
end $fn$;

comment on function import_usable_acres(jsonb, numeric) is
  'Bulk-write NWI-measured upland acreage onto properties. Never overwrites usable_acres_source=''manual''; skips rows whose cadastral polygon area disagrees with land_acres beyond the tolerance (a mis-matched parcel).';

grant execute on function import_usable_acres(jsonb, numeric) to authenticated;
