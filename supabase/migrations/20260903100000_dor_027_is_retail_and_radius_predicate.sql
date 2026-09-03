-- DOR class 027 (auto sales / repair / storage; garages) is RETAIL again, not industrial.
--
-- Alex, 2026-09-03: "remove 027 auto sales and repair from the dor code for industrial".
-- 20260816070000 had moved it INTO industrial on every axis; this undoes that on the same
-- axes, in lockstep: property_kind_from_dor, the dor_codes picker seed, warroom_predicate's
-- use-bucket + "industrial_any" zoning chip, and the frontend twins (isIndustrialUse,
-- dorBucket in src/lib/zoning.ts). 4,290 properties typed industrial by the 08-16 flip go
-- back to retail; their ids are kept in _rollback_dor027_retype_20260903.
--
-- Same edit of warroom_predicate also teaches it the new RADIUS filter
-- (p_filters->'radius' = {lat, lng, miles}) beside the polygon, so the server-side
-- predicate can answer the same question the map's client filter does.

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
    when v between 17 and 19 then 'office'::property_kind
    when v between 11 and 16 then 'retail'::property_kind
    when v between 20 and 29 then 'retail'::property_kind   -- 027 rides here again (2026-09-03)
    when v = 10              then 'retail'::property_kind
    when v between 50 and 69 then 'land'::property_kind
    when v in (0, 70, 99)    then 'land'::property_kind
    else 'other'::property_kind
  end
  from n;
$$;

update dor_codes set category = 'retail' where code = '027';

-- warroom_predicate was never committed to the repo (SQL-editor applied during the War
-- Room load-time work); patch the live text in place and refuse to apply if any fragment
-- has drifted from what this migration expects.
do $$
declare src text; before text;
begin
  select pg_get_functiondef('public.warroom_predicate(jsonb)'::regprocedure) into src;

  before := src;
  src := replace(src,
    $f$ or (dor_class(p.dor_use_code) between 20 and 39 and dor_class(p.dor_use_code) <> 27)'$f$,
    $f$ or (dor_class(p.dor_use_code) between 20 and 39)'$f$);
  if src = before then raise exception 'warroom_predicate: retail bucket fragment not found'; end if;

  before := src;
  src := replace(src,
    $f$ when (dor_class(p.dor_use_code) between 41 and 49) or dor_class(p.dor_use_code) = 27'$f$,
    $f$ when dor_class(p.dor_use_code) between 41 and 49'$f$);
  if src = before then raise exception 'warroom_predicate: industrial bucket fragment not found'; end if;

  before := src;
  src := replace(src,
    $f$ or (dor_class(p.dor_use_code) between 40 and 49 or dor_class(p.dor_use_code) = 27))'$f$,
    $f$ or dor_class(p.dor_use_code) between 40 and 49)'$f$);
  if src = before then raise exception 'warroom_predicate: industrial_any fragment not found'; end if;

  -- radius filter, right after the polygon clause
  before := src;
  src := replace(src,
    $f$  if v_lease_on and v_lease is not null and coalesce((v_lease->>'any')::boolean, false) then$f$,
    $f$  if jsonb_typeof(p_filters->'radius') = 'object' then
    declare
      rl numeric := (p_filters->'radius'->>'lat')::numeric;
      rg numeric := (p_filters->'radius'->>'lng')::numeric;
      rm numeric := (p_filters->'radius'->>'miles')::numeric;
      dlng numeric;
    begin
      if rl is not null and rg is not null and rm is not null and rm > 0 then
        dlng := rm / greatest(cos(radians(rl)) * 69.0, 0.0001);
        v_where := v_where || format(
          ' and p.lat is not null and p.lng is not null'
          || ' and p.lat between %s and %s and p.lng between %s and %s'
          || ' and st_dwithin(st_setsrid(st_makepoint(p.lng, p.lat), 4326)::geography,'
          || ' st_setsrid(st_makepoint(%s, %s), 4326)::geography, %s)',
          rl - rm / 69.0, rl + rm / 69.0, rg - dlng, rg + dlng, rg, rl, rm * 1609.344);
      end if;
    end;
  end if;

  if v_lease_on and v_lease is not null and coalesce((v_lease->>'any')::boolean, false) then$f$);
  if src = before then raise exception 'warroom_predicate: lease anchor not found'; end if;

  execute src;
end $$;

-- Retype the 027 rows the 08-16 flip made industrial. Rows a human has since moved to
-- land/office stay put; only industrial -> retail.
create table if not exists _rollback_dor027_retype_20260903 as
select id, property_type, now() as captured_at
from properties
where property_kind_from_dor(dor_use_code) = 'retail'
  and regexp_replace(coalesce(dor_use_code, ''), '\D', '', 'g') ~ '^(027|27\d\d|027\d\d)$'
  and property_type = 'industrial';

update properties p
set property_type = 'retail'
from _rollback_dor027_retype_20260903 r
where p.id = r.id and p.property_type = 'industrial';
