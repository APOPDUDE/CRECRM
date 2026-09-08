-- Deal Radar: a third listing type for lake / waterfront residential.
--
-- deal_radar_type was industrial|land, so the scraper's classifier had no way to
-- keep a lake house — normalizeListing returned null and the row was dropped. That
-- also silently discarded every post from the Subject-To groups, which are
-- residential by nature. Adding the type lets the NC lake-house search store
-- results and lets the UI filter them apart from the CRE feed.
alter type deal_radar_type add value if not exists 'lake_house';
