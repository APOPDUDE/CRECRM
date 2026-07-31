-- Florida DOR use codes -> our property_kind enum. Appraiser rows arrive with a DOR code but no
-- property_type, and the map has to be filterable by type, so derive it.
--
-- The DOR *class* is the FIRST TWO DIGITS. Codes arrive at three widths depending on the county:
-- Hillsborough/Pinellas/Sarasota/Polk "4800", Pasco "01000", Manatee "48". An earlier version of
-- this function cast the whole string to int, so '4800' became 4800, missed the 40-49 test and
-- fell through to 'other' -- it only ever worked for Manatee's 2-char codes.
--
-- Deliberately coarse: anything unrecognised stays 'other' rather than guessing wrong.
create or replace function property_kind_from_dor(p_code text)
returns property_kind
language sql
immutable
as $$
  with c as (
    select left(regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), 2) as d
  )
  select case
    when (select d from c) = '' then null
    when (select d from c)::int between 40 and 49 then 'industrial'::property_kind
    when (select d from c)::int between 17 and 19 then 'office'::property_kind
    when (select d from c)::int between 11 and 16 then 'retail'::property_kind
    when (select d from c)::int between 20 and 29 then 'retail'::property_kind
    when (select d from c)::int = 10              then 'retail'::property_kind
    when (select d from c)::int between 50 and 69 then 'land'::property_kind
    when (select d from c)::int in (0, 70, 99)    then 'land'::property_kind
    else 'other'::property_kind
  end;
$$;

comment on function property_kind_from_dor(text) is
  'Florida DOR use code -> property_kind, keyed on the FIRST TWO digits (codes are 2, 4 or 5 '
  'chars wide depending on county). 40-49 industrial, 17-19 office, 10-16/20-29 retail, '
  '50-69/0/70/99 land, everything else other.';

-- fill blanks only -- never overwrite a type a human or a listing set
update properties
set property_type = property_kind_from_dor(dor_use_code)
where property_type is null
  and dor_use_code is not null
  and property_kind_from_dor(dor_use_code) is not null;
