-- County CAMA use codes come in three shapes, and the classifier handled only two.
-- 20260814150000 normalized by "first three digits" for anything 3+ digits — right for
-- zero-padded FDOR codes ('048') and for Pasco's 5-digit variants ('04800' = 048 + '00'
-- subtype), WRONG for the other five counties' 4-digit codes, which are TWO-digit FDOR
-- class + two-digit county subtype: Sarasota '4804' = 48 warehousing (not 480 → 'other'),
-- and the zero-leading ones follow the same scheme — Sarasota '0100' = 01 single family
-- + '00', NOT 010 vacant commercial. 12,908 rows across 362 (county, code) pairs were
-- falling to 'other' on the county-use axis.
--
-- Rule verified parcel-by-parcel against the FDOR NAL roll (fl_parcels.duckdb, 11,803 of
-- 13,487 affected rows joined on the county parcel key):
--   4-digit codes:  first-two matches NAL dor_uc on 11,575/11,598; first-three on 67.
--                   Zero 4-digit (county, code) families prefer first-three — including
--                   every zero-leading family ('0100'→001, '0407'→004, '0340'→003).
--   5-digit codes (Pasco only): first-three matches 204/205; first-two only the
--                   degenerate '00000'.
-- So: digits only; <=3 digits are the code itself, exactly 4 take the first TWO,
-- 5+ take the first THREE. Mirrors dorInt() in src/lib/zoning.ts — keep in lockstep.

create or replace function property_kind_from_dor(p_code text)
returns property_kind
language sql
immutable
set search_path = public
as $$
  with c as (
    select regexp_replace(coalesce(p_code, ''), '\D', '', 'g') as d
  ),
  n as (
    select case
      when d = '' then null
      when length(d) = 4 then left(d, 2)::int
      when length(d) >= 5 then left(d, 3)::int
      else d::int
    end as v
    from c
  )
  select case
    when v is null then null
    when v between 40 and 49 then 'industrial'::property_kind
    when v between 17 and 19 then 'office'::property_kind
    when v between 11 and 16 then 'retail'::property_kind
    when v between 20 and 29 then 'retail'::property_kind
    when v = 10              then 'retail'::property_kind
    when v between 50 and 69 then 'land'::property_kind
    when v in (0, 70, 99)    then 'land'::property_kind
    else 'other'::property_kind
  end
  from n;
$$;

comment on function property_kind_from_dor(text) is
  'DOR use code -> property_kind. Normalization: digits only; <=3 digits as-is, 4 digits = 2-digit class + county subtype (first two), 5+ = FDOR code + subtype (first three). Mirrors dorInt() in src/lib/zoning.ts.';

-- Repair the rows the old rule mistyped, same shape as 20260814150000: only untyped /
-- 'other' rows are touched — a real type (importer read it off the NAL roll, or someone
-- set it) is a judgement the code alone must not override. property_type is not among
-- the county-locked columns (gross_sf/heated_sf/land_acres/year_built), so no
-- app.county_import setting is needed.
update properties
set property_type = property_kind_from_dor(dor_use_code)
where (property_type is null or property_type = 'other')
  and dor_use_code is not null
  and property_kind_from_dor(dor_use_code) is distinct from 'other'
  and property_kind_from_dor(dor_use_code) is not null;
