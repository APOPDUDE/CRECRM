-- Audit cleanup (data quality): merge duplicate property rows.
-- Scrape import dedupes by source_key but not by address, so the same physical address landed as
-- multiple property rows under different source_keys, fragmenting the comps price-history that
-- v_property_current_asking / the market views read. This consolidates true twins (same normalized
-- address+city) onto one canonical row and re-points every child FK before deleting the empties.
--
-- SAFETY:
--   * Excludes the 10 multi-parcel groups (rows sharing a street address but with >1 distinct
--     parcel_number are legitimately different parcels) and any blank-city group.
--   * Canonical = the most complete row (has parcel, then coords, then most child refs, then oldest).
--   * Re-points ALL FK children (comps, pursuits, listings, units, listing_parcels, files) so the
--     ON DELETE CASCADE FKs (comps/files/units/listing_parcels) never silently delete real data.
--   * Pre-verified zero unique collisions (pursuits client/property, listing_parcels listing/property).
--   * Asserts child row counts are unchanged after the merge; aborts (rolls back) on any drift.
-- Dry-run (rolled back) confirmed: 88 rows deleted (2315->2227), comps/pursuits/files/listings counts
-- unchanged, 0 twins remaining.

do $$
declare
  v_comps_before int; v_comps_after int;
  v_pursuits_before int; v_pursuits_after int;
  v_files_before int; v_files_after int;
  v_listings_before int; v_listings_after int;
  v_deleted int;
begin
  create temp table _merge_map on commit drop as
  with norm as (
    select p.id, lower(btrim(p.address)) a, lower(btrim(coalesce(p.city,''))) c,
           p.parcel_number, p.lat, p.created_at,
           (select count(*) from comps cc where cc.property_id=p.id)
            +(select count(*) from pursuits pu where pu.property_id=p.id)
            +(select count(*) from listings l where l.property_id=p.id)
            +(select count(*) from units u where u.property_id=p.id)
            +(select count(*) from listing_parcels lp where lp.property_id=p.id) refcount
    from properties p
    where p.address not ilike '%unavailable%' and p.address not ilike 'Portfolio of %'
  ),
  grp as (
    select a,c from norm group by a,c
    having count(*)>1 and count(distinct parcel_number) filter (where parcel_number is not null) <= 1
       and a<>'' and c<>''
  ),
  members as (
    select n.*, row_number() over (partition by n.a,n.c
      order by (n.parcel_number is not null) desc,(n.lat is not null) desc,n.refcount desc,n.created_at asc,n.id asc) rn
    from norm n join grp g on g.a=n.a and g.c=n.c
  ),
  canon as (select a,c,id canonical_id from members where rn=1)
  select m.id dup_id, cn.canonical_id
  from members m join canon cn on cn.a=m.a and cn.c=m.c
  where m.rn>1;

  select count(*) into v_comps_before from comps;
  select count(*) into v_pursuits_before from pursuits;
  select count(*) into v_files_before from files;
  select count(*) into v_listings_before from listings;

  update comps           set property_id=mm.canonical_id from _merge_map mm where comps.property_id=mm.dup_id;
  update pursuits        set property_id=mm.canonical_id from _merge_map mm where pursuits.property_id=mm.dup_id;
  update listings        set property_id=mm.canonical_id from _merge_map mm where listings.property_id=mm.dup_id;
  update units           set property_id=mm.canonical_id from _merge_map mm where units.property_id=mm.dup_id;
  update listing_parcels set property_id=mm.canonical_id from _merge_map mm where listing_parcels.property_id=mm.dup_id;
  update files           set property_id=mm.canonical_id from _merge_map mm where files.property_id=mm.dup_id;

  delete from properties where id in (select dup_id from _merge_map);
  get diagnostics v_deleted = row_count;

  select count(*) into v_comps_after from comps;
  select count(*) into v_pursuits_after from pursuits;
  select count(*) into v_files_after from files;
  select count(*) into v_listings_after from listings;

  if v_comps_after <> v_comps_before
     or v_pursuits_after <> v_pursuits_before
     or v_files_after <> v_files_before
     or v_listings_after <> v_listings_before then
    raise exception 'MERGE ABORTED: child counts drifted (comps %->%, pursuits %->%, files %->%, listings %->%)',
      v_comps_before, v_comps_after, v_pursuits_before, v_pursuits_after,
      v_files_before, v_files_after, v_listings_before, v_listings_after;
  end if;

  raise notice 'Merged duplicate properties: deleted % rows; child counts preserved.', v_deleted;
end $$;
