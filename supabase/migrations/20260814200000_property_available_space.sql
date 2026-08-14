-- Space a client could actually take, from both places it is known.
--
-- Alex asked whether on-market asking leases advertising less than the whole
-- building should be COPIED into `units`. 634 properties are in that position,
-- 560 of them on-market - real space, invisible to a size search today.
--
-- Copying is the wrong shape, and the data says so: **178 of those 560 have
-- already had their advertised SF change between scrapes.** A copied unit would
-- be right on the day it was written and wrong the next time the listing
-- re-sized, with nothing to update it. Two records of one fact, drifting.
--
-- So this derives instead. Nothing is duplicated, no new association, and the
-- sweep keeps the listing half fresh on its own:
--
--   * `unit`    - hand-entered. What Alex knows a landlord will carve out.
--                 Nobody else knows this; it exists only because he wrote it down.
--   * `listing` - the current asking comp, scraped. What the market is publicly
--                 advertising. Refreshes itself; never edited by hand.
--
-- A view rather than frontend code because the schema is the API - n8n, the phone
-- and any future matcher get the same answer as the Properties filter.
create or replace view v_property_available_space as
-- What Alex recorded. `status` gates it: a let unit must stop offering space
-- that is gone, which is worse than never having recorded it.
select u.property_id,
       u.size_sf,
       u.size_acres,
       'unit'::text  as space_source,
       u.label,
       u.asking_rate_psf
from units u
where coalesce(u.status, 'available') = 'available'
  and (u.size_sf is not null or u.size_acres is not null)

union all

-- What the market advertises, taken from the LATEST asking comp only. Older rows
-- in that time series are price history, not availability.
select c.property_id,
       c.sf        as size_sf,
       null::numeric as size_acres,
       'listing'::text as space_source,
       null::text  as label,
       c.asking_lease_rate_psf
from (
  select distinct on (property_id)
         property_id, sf, asking_lease_rate_psf, as_of_date, created_at
  from comps
  where kind = 'asking' and deal_type in ('lease', 'both')
  order by property_id, as_of_date desc nulls last, created_at desc
) c
join properties p on p.id = c.property_id
where c.sf is not null
  and c.sf > 0
  and p.gross_sf > 0
  -- Only a PART of the building is a unit. A listing marketing the whole thing
  -- is the building itself, which the size filter already matches on gross_sf;
  -- emitting it here would just duplicate that row.
  and c.sf < p.gross_sf * 0.95
  -- Off-market means the advertisement is gone, whatever the last scrape said.
  and p.listing_status = 'on_market';

comment on view v_property_available_space is
  'Lettable space per property from BOTH sources: hand-entered units (what Alex knows) and the latest on-market asking comp where it advertises less than the whole building (what the market shows). Derived, never copied - 178 of the 560 listing rows have already changed size between scrapes, so a copy into units would drift. Feeds the Properties size filter.';

grant select on v_property_available_space to authenticated, anon;
