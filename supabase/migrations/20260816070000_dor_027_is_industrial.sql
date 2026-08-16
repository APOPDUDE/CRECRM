-- DOR class 027 (auto sales / repair / storage; garages) is INDUSTRIAL, not retail.
--
-- Alex, 2026-08-16 ("its marking 2703 dor code as retail on the map it should be
-- industrial"): 027 is his niche and already files as industrial on every other axis —
-- isIndustrialUse() (040-049 + 027), the dor_codes picker seed, the "All industrial"
-- chip definition. property_kind_from_dor was the last holdout: its 20-29 -> retail
-- branch swept 027 along with restaurants and service stations, so 4,270 vehicle-repair
-- properties wore property_type='retail' (e.g. 3929 S 50th St, dor 2703).
--
-- Frontend twin updated in lockstep: dorBucket() in src/lib/zoning.ts (County-use axis).

create or replace function public.property_kind_from_dor(p_code text)
returns property_kind
language sql
immutable
set search_path to 'public'
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
    when v = 27              then 'industrial'::property_kind  -- Alex's niche rides with industrial
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

-- Retype the rows the OLD rule classified: retail/other/null flip to industrial where
-- the DOR class is 027. Rows a human moved elsewhere (55 industrial already, 4 land,
-- 2 office at time of writing) are deliberate deviations and stay put.
update properties
set property_type = 'industrial'
where property_kind_from_dor(dor_use_code) = 'industrial'
  and (
    select case
      when d = '' then null
      when length(d) = 4 then left(d, 2)::int
      when length(d) >= 5 then left(d, 3)::int
      else d::int
    end
    from (select regexp_replace(coalesce(dor_use_code, ''), '\D', '', 'g') as d) x
  ) = 27
  and (property_type in ('retail', 'other') or property_type is null);
