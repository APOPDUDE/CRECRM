-- property_kind_from_dor read the first TWO digits of the code, which is only right when
-- the county sends bare codes ("48"). FDOR and the parcel imports send zero-padded
-- three-digit codes ("048"), and left('048', 2) = '04' = 4 — which fell through to
-- 'other'. Result: ~5,200 warehouse/manufacturing parcels typed 'other', invisible to
-- every property_type='industrial' filter, and all 027 vehicle-repair rows untyped too.
--
-- The FDOR use code is three digits; longer values are county CAMA variants that lead
-- with the DOR code ("0100" = 010 + subcode). So: keep bare 1-2 digit codes as-is,
-- otherwise the first three digits are the code.

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
      when length(d) >= 3 then left(d, 3)::int
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

-- Repair the rows the bug mistyped. Only rows currently 'other' are touched: a type that
-- was set deliberately (or by a scrape) is someone's judgement, but 'other' + a DOR code
-- that maps cleanly is just the bug's residue. The DOR code itself is county truth.
update properties
set property_type = property_kind_from_dor(dor_use_code)
where property_type = 'other'
  and dor_use_code is not null
  and property_kind_from_dor(dor_use_code) is distinct from 'other'
  and property_kind_from_dor(dor_use_code) is not null;
