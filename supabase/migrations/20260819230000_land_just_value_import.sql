-- County land-value allocation: the FDOR roll's LND_VAL / JV pair, backfilled from
-- data/fl_parcels.duckdb (NAL 2026 preliminary) via the bulk-load edge pipe.
--
-- Why: the comp sheet's executed-sale split ("how much was the land vs the building")
-- allocates a sale price by the county's own land share: land $ = price x share,
-- building $ = the rest. Both numbers come from the SAME roll row, so the ratio is
-- internally consistent even where properties.just_value (county sync, a different
-- vintage) disagrees with the roll's JV.

alter table properties
  add column if not exists land_just_value numeric,
  add column if not exists land_value_share numeric
    constraint properties_land_share_range
    check (land_value_share is null or (land_value_share >= 0 and land_value_share <= 1));

comment on column properties.land_just_value is
  'County land value (FDOR roll LND_VAL, 2026 preliminary). A county-roll fact, not an appraisal. Backfilled 2026-08-19.';
comment on column properties.land_value_share is
  'LND_VAL / JV from the same FDOR roll row - the county''s allocation of value to land. Feeds the sale-comp land/building split in estimate_property_value().';

-- Payload rows: {id, land_just_value, roll_just_value}. Matched to the roll and
-- ambiguity-guarded on the duckdb side; this end only sanity-checks and writes.
-- Set-based (no per-row loop) so a full-book chunk clears PostgREST's timeout.
create or replace function import_land_values(p jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with incoming as (
    select (e->>'id')::uuid as id,
           nullif(e->>'land_just_value','')::numeric as lv,
           nullif(e->>'roll_just_value','')::numeric as jv
      from jsonb_array_elements(p) e
  ),
  valid as (
    select * from incoming
     where id is not null
       and lv is not null and jv is not null
       and jv > 0 and lv >= 0 and lv <= jv
  ),
  updated as (
    update properties pr
       set land_just_value  = v.lv,
           land_value_share = round(v.lv / v.jv, 4)
      from valid v
     where pr.id = v.id
     returning pr.id
  )
  select jsonb_build_object(
    'received', (select count(*) from incoming),
    'updated',  (select count(*) from updated),
    'rejected', (select count(*) from incoming) - (select count(*) from valid)
  );
$$;

-- The bulk-load edge fn calls this as service_role; the anon role has no business here.
revoke execute on function import_land_values(jsonb) from public, anon;
grant execute on function import_land_values(jsonb) to authenticated, service_role;
