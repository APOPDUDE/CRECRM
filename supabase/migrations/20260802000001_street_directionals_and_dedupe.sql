-- "3120 North Dover Rd" and "3120 N Dover Rd" are the same building; the street key now
-- folds spelled-out directionals (NORTH/SOUTH/EAST/WEST -> N/S/E/W) so the importers'
-- dedupe and match_addresses agree. The three expression indexes are rebuilt because the
-- function behind them changed. Then the 30 duplicate groups (62 rows) the old key let
-- through are merged: keeper = the row with market history (non-import source), else the
-- oldest; the duplicate fills the keeper's blanks; every FK is repointed via the catalog
-- (files/notes/tasks use real FK columns post-redesign, so the loop covers them);
-- unique-violation collisions (same suggestion/deal flag on both rows) drop the dup side
-- since those are regenerable derived rows.
create or replace function normalize_street(p_addr text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(upper(split_part(coalesce(p_addr, ''), ',', 1)), '[.,#]', '', 'g'),
                '\mNORTH\M', 'N', 'g'),
              '\mSOUTH\M', 'S', 'g'),
            '\mEAST\M', 'E', 'g'),
          '\mWEST\M', 'W', 'g'),
        '\s+', ' ', 'g'),
      '^\s+|\s+$', '', 'g'),
    ''
  );
$$;

reindex index properties_norm_street_idx;
reindex index properties_norm_street_loose_idx;
reindex index properties_norm_street_city_idx;

do $$
declare
  grp record;
  keeper uuid;
  dup uuid;
  r record;
  n_merged int := 0;
begin
  for grp in
    select array_agg(id order by (source in ('owner_import','county_appraiser')), created_at) as ids
    from properties
    group by normalize_street(address), upper(coalesce(btrim(city), ''))
    having count(*) > 1
  loop
    keeper := grp.ids[1];
    for i in 2..array_length(grp.ids, 1) loop
      dup := grp.ids[i];

      update properties k
      set owner_name            = coalesce(k.owner_name, d.owner_name),
          owner_mailing_address = coalesce(k.owner_mailing_address, d.owner_mailing_address),
          owner_id              = coalesce(k.owner_id, d.owner_id),
          parcel_number         = coalesce(k.parcel_number, d.parcel_number),
          county                = coalesce(k.county, d.county),
          property_type         = coalesce(k.property_type, d.property_type),
          building_sf           = coalesce(k.building_sf, d.building_sf),
          land_acres            = coalesce(k.land_acres, d.land_acres),
          year_built            = coalesce(k.year_built, d.year_built),
          lat                   = coalesce(k.lat, d.lat),
          lng                   = coalesce(k.lng, d.lng),
          zip                   = coalesce(k.zip, d.zip),
          dor_use_code          = coalesce(k.dor_use_code, d.dor_use_code),
          just_value            = coalesce(k.just_value, d.just_value),
          assessed_value        = coalesce(k.assessed_value, d.assessed_value),
          last_sale_date        = coalesce(k.last_sale_date, d.last_sale_date),
          last_sale_price       = coalesce(k.last_sale_price, d.last_sale_price)
      from properties d
      where k.id = keeper and d.id = dup;

      for r in
        select con.conrelid::regclass::text as tbl, att.attname as col
        from pg_constraint con
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
        where con.confrelid = 'public.properties'::regclass and con.contype = 'f'
      loop
        begin
          execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col)
            using keeper, dup;
        exception when unique_violation then
          execute format('delete from %s where %I = $1', r.tbl, r.col) using dup;
        end;
      end loop;

      delete from properties where id = dup;
      n_merged := n_merged + 1;
    end loop;
  end loop;
  raise notice 'merged % duplicate property rows', n_merged;
end $$;
