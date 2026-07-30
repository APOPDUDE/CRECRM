-- Florida DOR use codes -> our property_kind enum. Address-matched appraiser rows arrive with a
-- DOR code but no property_type, and the map has to be filterable by type, so derive it.
-- Deliberately coarse: anything unrecognised stays 'other' rather than guessing wrong.
create or replace function property_kind_from_dor(p_code text)
returns property_kind
language sql
immutable
as $$
  select case
    when p_code is null then null
    -- codes arrive as '048', '48', '0048'
    when (regexp_replace(p_code, '\D', '', 'g'))::int between 40 and 49 then 'industrial'::property_kind
    when (regexp_replace(p_code, '\D', '', 'g'))::int between 17 and 19 then 'office'::property_kind
    when (regexp_replace(p_code, '\D', '', 'g'))::int between 11 and 16 then 'retail'::property_kind
    when (regexp_replace(p_code, '\D', '', 'g'))::int between 20 and 29 then 'retail'::property_kind
    when (regexp_replace(p_code, '\D', '', 'g'))::int = 10           then 'retail'::property_kind
    when (regexp_replace(p_code, '\D', '', 'g'))::int between 50 and 69 then 'land'::property_kind
    when (regexp_replace(p_code, '\D', '', 'g'))::int in (0, 70, 99)    then 'land'::property_kind
    else 'other'::property_kind
  end
  where p_code ~ '\d';
$$;

comment on function property_kind_from_dor(text) is
  'Florida DOR use code -> property_kind. 40-49 industrial, 17-19 office, 10-16/20-29 retail, '
  '50-69/0/70/99 land, everything else other.';
