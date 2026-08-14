-- Two sources disagree about wet ground, so keep both rather than pick a winner.
--
-- Alex on 9501 Palm River Rd: "it says usable acres is about 13 but the lowlands is
-- actually almost 13, leaving only 3-4 acres of highlands. Is there an issue with
-- our data?"
--
-- The pipeline was faithful. The parcel polygon matched our acreage exactly (16.95)
-- and NWI really does map only 3.79 wet acres inside it. But Hillsborough's own land
-- lines call 13.70 acres LOWLANDS (use code 9610) and value them at $750/acre against
-- $232k/acre for the 4.06 commercial acres. Alex was right about the property and NWI
-- was not lying - they measure different things:
--
--   NWI     - jurisdictional wetland, photo-interpreted, national, uniform
--   9610    - an ASSESSMENT judgement about buildable ground, by the people who price it
--
-- Measured over 60 Hillsborough parcels, NWI finds MORE wet ground in aggregate
-- (388.7 ac vs 304.8) but they disagree hard in BOTH directions per parcel. Neither
-- is truth, and averaging them would be worse than either. So `usable_acres` takes
-- the HARSHER reading - a broker should never be sold yard that turns out to be
-- swamp - and both inputs stay visible so a disagreement is inspectable rather than
-- silently resolved.
--
-- Source: HCPA's own property API, no auth:
--   https://gis.hcpafl.org/CommonServices/property/search//ParcelData?pin=<STRAP>
-- -> .landLines[] with {landUse:{code,description}, landType:{code}, units, value}.
-- The bulk downloads at downloads.hcpafl.org do NOT carry land lines; parcel.dbf is
-- parcel-level only. Runbook in data/README.md.
alter table properties add column if not exists wet_acres_nwi numeric;
alter table properties add column if not exists lowlands_acres_county numeric;

comment on column properties.wet_acres_nwi is
  'Wetland acres inside the parcel per the USFWS National Wetlands Inventory (photo-interpreted, jurisdictional).';
comment on column properties.lowlands_acres_county is
  'Acres the county appraiser classifies as unbuildable low ground (Hillsborough land use 9610 LOWLANDS and kin). An assessment judgement, not a wetland delineation - and priced near zero on the roll.';

-- Lossless: carry the existing NWI-derived figure across before usable_acres
-- stops being a stored value.
update properties
   set wet_acres_nwi = greatest(0, round(land_acres - usable_acres, 3))
 where usable_acres is not null and land_acres is not null and wet_acres_nwi is null;

-- usable_acres and net_usable_acres become GENERATED. They can no longer drift from
-- their inputs, and re-running either source updates every dependent number for free.
alter table properties drop column if exists net_usable_acres;
alter table properties drop column if exists usable_acres;

alter table properties
  add column usable_acres numeric
  generated always as (
    case when land_acres is null then null
         else greatest(0, round(land_acres
                - greatest(coalesce(wet_acres_nwi, 0), coalesce(lowlands_acres_county, 0)), 2))
    end
  ) stored;

alter table properties
  add column net_usable_acres numeric
  generated always as (
    case
      when land_acres is null then null
      else round(greatest(0,
             greatest(0, land_acres
                - greatest(coalesce(wet_acres_nwi, 0), coalesce(lowlands_acres_county, 0)))
             - coalesce(gross_sf, heated_sf, 0)::numeric / 43560), 2)
    end
  ) stored;

comment on column properties.usable_acres is
  'Upland acres: land_acres less the HARSHER of the NWI wetland reading and the county lowlands classification. GENERATED - set wet_acres_nwi / lowlands_acres_county, not this.';
comment on column properties.net_usable_acres is
  'Usable yard: uplands minus the gross building footprint. GENERATED.';

/**
 * Bulk-write the county's lowlands acreage.
 *
 * Caps at the parcel's own acreage: a lowlands figure larger than the whole parcel
 * means the county is describing a different parcel than we think we hold, and a
 * silent over-subtraction would zero out a site that is actually dry.
 */
create or replace function import_county_lowlands(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare v_updated int; v_over int;
begin
  with input as (
    select (r->>'property_id')::uuid as property_id,
           (r->>'lowlands_acres')::numeric as low
    from jsonb_array_elements(p) r
  ),
  judged as (
    select i.*, pr.land_acres, least(i.low, pr.land_acres) as capped
    from input i join properties pr on pr.id = i.property_id
    where pr.land_acres > 0
  ),
  applied as (
    update properties pr set lowlands_acres_county = j.capped
      from judged j where pr.id = j.property_id
    returning case when j.low > j.land_acres + 0.01 then 1 else 0 end as over
  )
  select count(*), coalesce(sum(over),0) into v_updated, v_over from applied;
  return jsonb_build_object('updated', v_updated, 'capped_to_parcel', v_over);
end $fn$;

grant execute on function import_county_lowlands(jsonb) to authenticated;
