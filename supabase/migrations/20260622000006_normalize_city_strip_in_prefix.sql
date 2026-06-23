-- The scraper sometimes prepends a stray "in " to the city ("in Tampa"). Normalize the
-- stored city value in the county trigger (covers INSERT + UPDATE OF city, incl. the
-- import on-conflict path) and backfill the existing rows. The regex requires whitespace
-- after in/In so legit names like "Indianapolis" are untouched.
create or replace function public.set_property_county()
returns trigger language plpgsql as $function$
begin
  if new.city is not null then
    new.city := nullif(btrim(regexp_replace(new.city, '^\s*[Ii][Nn]\s+', '')), '');
  end if;
  new.county := (
    select cl.county from county_lookup cl
    where cl.city_key = lower(btrim(coalesce(new.city,'')))
  );
  return new;
end $function$;

-- one-time backfill of the already-stored "in <City>" values (re-fires the trigger,
-- which re-derives county from the cleaned city)
update properties
set city = nullif(btrim(regexp_replace(city, '^\s*[Ii][Nn]\s+', '')), '')
where city ~* '^\s*in\s+';
