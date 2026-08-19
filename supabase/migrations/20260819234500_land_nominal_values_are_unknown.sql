-- A nominal county land value is NOT an allocation. Every county's roll carries a
-- placeholder convention (LND_VAL = $100 or similar) on condos and parcels whose land is
-- folded into the improvement assessment — Hillsborough alone has 48K such parcels, and
-- 1425 Tech Blvd (10.84 ac of industrial) imported as "county puts 0% in the land".
-- Rule: LND_VAL <= $1,000 means the county isn't telling us the split — store NULL, not 0.

update properties
   set land_just_value = null, land_value_share = null
 where land_just_value is not null and land_just_value <= 1000;

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
       -- lv <= 1000 is the nominal-land placeholder, not a measurement
       and jv > 0 and lv > 1000 and lv <= jv
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
