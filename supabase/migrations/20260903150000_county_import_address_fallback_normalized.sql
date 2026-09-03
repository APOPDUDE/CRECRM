-- Parcel-first identity, phase 4: the county importer's address fallback.
--
-- import_county_parcels resolved a roll row by parcel_number, then parcel_key, then an EXACT
-- normalize_street(address) match against ANY property -- so "3145 HWY 92" never met the
-- scraped "3145 US Highway 92 E" (a twin was minted), while a lucky exact hit could land on
-- a row that carries a DIFFERENT parcel (a wrong twin). Now: the fallback is normalized
-- (normalize_address_text: Highway = Hwy, North = N; site_address counts) and only claims
-- rows that have NO parcel yet. Rows with another parcel are never the same building.
--
-- The live body was never committed (SQL-editor era); patch it in place with an asserted
-- replace, as 20260903100000 did for warroom_predicate.
do $$
declare src text; before text;
begin
  select pg_get_functiondef('public.import_county_parcels(jsonb)'::regprocedure) into src;
  before := src;
  src := regexp_replace(src,
    'select id into v_id from properties\s+where normalize_street\(address\) = normalize_street\(v_addr\)\s+and \(v_city is null or city is null or upper\(btrim\(city\)\) = upper\(v_city\)\)\s+limit 1;',
$f$select id into v_id from properties
      where nullif(split_part(parcel_key, '|', 1), '') is null          -- never a row with another parcel
        and not coalesce(is_condo_unit, false)
        and (v_city is null or city is null or upper(btrim(city)) = upper(v_city))
        and (normalize_street(address) = normalize_street(v_addr)
             or normalize_address_text(address) = normalize_address_text(v_addr)
             or (site_address is not null
                 and normalize_address_text(site_address) = normalize_address_text(v_addr)))
      order by (county = v_county) desc, created_at
      limit 1;$f$);
  if src = before then raise exception 'import_county_parcels: address fallback fragment not found'; end if;
  execute src;
end $$;
