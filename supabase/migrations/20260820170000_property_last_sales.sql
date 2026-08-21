-- Last-sale dates for the War Room's "recently sold" filter (Alex, 2026-08-20: "so we don't
-- call people who just sold their property").
--
-- The sale history lives on transfer comps (R7: county-fed, importer appends), so this is a
-- read model, not new state: one jsonb map property_id -> latest transfer as_of_date. jsonb so
-- the PostgREST 1000-row cap cannot silently truncate it -- coverage is partial by nature
-- (Hillsborough 27%, Polk 48% of properties have any recorded sale), which is why the UI
-- carries an "include properties with no sold date" toggle, default ON.

begin;

create or replace function property_last_sales() returns jsonb
language sql stable security definer
set search_path to public
as $$
  select coalesce(jsonb_object_agg(property_id, last_sale), '{}'::jsonb)
  from (
    select property_id, max(as_of_date) as last_sale
    from comps
    where kind = 'transfer' and property_id is not null and as_of_date is not null
    group by property_id
  ) s
$$;

comment on function property_last_sales() is
  'property_id -> latest transfer-comp as_of_date, as one jsonb map (immune to the PostgREST '
  'row cap). Drives the War Room "hide recently sold" filter. Absence means no recorded sale, '
  'not "never sold".';

commit;
