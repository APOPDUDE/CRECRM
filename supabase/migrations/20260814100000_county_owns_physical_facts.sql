-- The county appraiser owns the physical facts. Nothing else may overwrite them.
--
-- 9707 Williams Rd (stored under its marketing address 9951) came in from a scrape
-- with gross_sf 60,000. The county says 93,666 gross / 91,982 heated - and the CRM
-- had the heated figure right, because the appraiser pull landed there. The row was
-- self-evidently broken: **heated_sf 91,982 was LARGER than gross_sf 60,000**, which
-- cannot happen.
--
-- It is not one row. Against the county's own CAMA extracts:
--   * 3,400 of 11,928 matched properties (28.5%) have gross_sf off by >10%
--   * scraped rows are wrong 59% of the time; owner_import 23%; manual 34%
--   * 1,758 properties carry heated_sf > gross_sf
--   * 1,059 carry gross_sf = 0
--
-- So these four columns become county-owned: gross_sf, heated_sf, land_acres,
-- year_built. Alex's rule, and he is right - a listing site's marketing number and
-- a hand-typed one are both guesses next to the roll.
--
-- ENFORCED IN POSTGRES, not just hidden in the UI. A trigger reverts any change to
-- a county-synced field unless the session sets `app.county_import`. Hiding a field
-- in React would leave the API, n8n, the phone Claude and the next importer free to
-- put 60,000 back.

alter table properties add column if not exists county_synced_at timestamptz;

comment on column properties.county_synced_at is
  'When gross_sf / heated_sf / land_acres / year_built were last taken from the county roll. Non-null means those four are county-owned and the properties_county_owned_fields trigger will revert any other writer.';

/**
 * Revert edits to county-owned physical facts.
 *
 * Only a caller that has set `app.county_import` for the transaction may change
 * them - that is the county importer, and nothing else. Everyone else's value is
 * silently replaced with the county's, which is the point: the front end, the REST
 * API, n8n and a future bulk import all have to lose this argument the same way.
 */
create or replace function properties_county_owned_fields()
returns trigger
language plpgsql
as $fn$
begin
  if old.county_synced_at is null then
    return new;                                   -- never synced: nothing to defend
  end if;
  if coalesce(current_setting('app.county_import', true), '') = 'on' then
    return new;                                   -- the importer itself
  end if;
  new.gross_sf    := old.gross_sf;
  new.heated_sf   := old.heated_sf;
  new.land_acres  := old.land_acres;
  new.year_built  := old.year_built;
  return new;
end $fn$;

drop trigger if exists properties_county_owned on properties;
create trigger properties_county_owned
  before update on properties
  for each row execute function properties_county_owned_fields();

/**
 * Write the county's building and land figures.
 *
 * p is [{property_id, gross_sf, heated_sf, land_acres, year_built}, ...]; any key
 * omitted or null is left alone, so a county that publishes buildings but not
 * acreage does not blank the acreage.
 *
 * Skips a row whose county gross_sf is absent or zero - "the county has no building
 * on file" is not the same as "the building is 0 SF", and writing the latter would
 * erase a real figure.
 */
create or replace function import_county_building_data(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_updated int := 0;
  v_skipped int := 0;
begin
  perform set_config('app.county_import', 'on', true);

  with input as (
    select (r->>'property_id')::uuid  as property_id,
           nullif((r->>'gross_sf'), '')::numeric   as gross_sf,
           nullif((r->>'heated_sf'), '')::numeric  as heated_sf,
           nullif((r->>'land_acres'), '')::numeric as land_acres,
           nullif((r->>'year_built'), '')::int     as year_built
    from jsonb_array_elements(p) r
  ),
  usable as (
    select * from input where coalesce(gross_sf, 0) > 0
  ),
  applied as (
    update properties pr
       set gross_sf   = coalesce(u.gross_sf::int, pr.gross_sf),
           -- heated can legitimately be absent; never let it exceed gross
           heated_sf  = least(coalesce(u.heated_sf::int, pr.heated_sf),
                              coalesce(u.gross_sf::int, pr.gross_sf)),
           land_acres = coalesce(u.land_acres, pr.land_acres),
           year_built = coalesce(u.year_built, pr.year_built),
           county_synced_at = now()
      from usable u
     where pr.id = u.property_id
    returning 1
  )
  select (select count(*) from applied),
         (select count(*) from input) - (select count(*) from usable)
    into v_updated, v_skipped;

  return jsonb_build_object('updated', v_updated, 'skipped_no_county_gross', v_skipped);
end $fn$;

comment on function import_county_building_data(jsonb) is
  'Write county-roll gross_sf/heated_sf/land_acres/year_built onto properties and mark them county-owned. The only caller permitted to change those four - see properties_county_owned_fields().';

grant execute on function import_county_building_data(jsonb) to authenticated;
