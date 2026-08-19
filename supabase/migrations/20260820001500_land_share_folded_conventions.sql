-- Mirror artifact of the nominal-land rule (20260819234500): LND_VAL = JV on an IMPROVED
-- parcel is the county's improvements-folded-into-land convention (281 parcels in the book) —
-- it renders "building $0 ($0.00/SF)" splits on real buildings. And a share that ROUNDS to
-- 0.0000 (lv > $1,000 but jv in the tens of millions) is the same 0%-land artifact arriving
-- via rounding. Null both cases; share = 1 on VACANT parcels stays — all-land is a real split.

update properties p
   set land_just_value = null, land_value_share = null
 where p.land_value_share is not null
   and ( (p.land_value_share >= 1 and coalesce(p.gross_sf, p.heated_sf, 0) > 0)
      or p.land_value_share <= 0 );

-- Importer v3, same contract. Hardened per review:
--   * safe casts — one malformed row no longer aborts the whole chunk
--   * an id sent twice with CONFLICTING values is ambiguous and dropped entirely
--   * folded-convention and rounds-to-zero shares rejected (needs the properties join for SF)
--   * 'rejected' is now received - updated, so unmatched ids no longer vanish from the count
create or replace function import_land_values(p jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with incoming as (
    select nullif(e->>'id','') as id_txt,
           nullif(e->>'land_just_value','') as lv_txt,
           nullif(e->>'roll_just_value','') as jv_txt
      from jsonb_array_elements(p) e
  ),
  typed as (
    select case when id_txt ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then id_txt::uuid end as id,
           case when lv_txt ~ '^[0-9]+(\.[0-9]+)?$' then lv_txt::numeric end as lv,
           case when jv_txt ~ '^[0-9]+(\.[0-9]+)?$' then jv_txt::numeric end as jv
      from incoming
  ),
  uniq as (
    select id, min(lv) as lv, min(jv) as jv
      from typed
     where id is not null and lv is not null and jv is not null
     group by id
    having min(lv) = max(lv) and min(jv) = max(jv)
  ),
  valid as (
    select u.id, u.lv, round(u.lv / u.jv, 4) as share
      from uniq u
      join properties pr on pr.id = u.id
     where u.jv > 0 and u.lv > 1000 and u.lv <= u.jv
       and round(u.lv / u.jv, 4) > 0
       and (round(u.lv / u.jv, 4) < 1 or coalesce(pr.gross_sf, pr.heated_sf, 0) <= 0)
  ),
  updated as (
    update properties pr
       set land_just_value  = v.lv,
           land_value_share = v.share
      from valid v
     where pr.id = v.id
     returning pr.id
  )
  select jsonb_build_object(
    'received', (select count(*) from incoming),
    'updated',  (select count(*) from updated),
    'rejected', (select count(*) from incoming) - (select count(*) from updated)
  );
$$;
