-- The first listing_queue joined v_property_current_asking (a distinct-on over the whole
-- comps table) across every candidate row AND scanned it four more times for the tab
-- counts: five expensive passes. Fine as postgres, but it blew the statement timeout over
-- REST. The cheap base below is what filtering and counting run on; the asking comp is
-- joined only for the <=50 rows actually returned (see the next migration for the
-- surviving function body).
create or replace view v_listing_queue_base as
select
  p.id                              as property_id,
  p.address, p.city, p.state, p.zip, p.county,
  p.property_type, p.gross_sf, p.land_acres, p.lat, p.lng,
  p.parcel_number, p.source_key, p.title,
  p.created_at                      as first_seen,
  listing_match_state(p.parcel_number, p.lat) as match_state,
  coalesce(lr.status, 'new'::listing_review_status) as review_status,
  lr.attached_property_id, lr.note, lr.reviewed_at
from properties p
left join listing_reviews lr on lr.property_id = p.id
where p.source = 'scrape'
  and p.listing_status = 'on_market';
