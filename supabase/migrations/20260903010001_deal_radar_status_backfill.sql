-- Backfill existing rows into the new approve/decline model.
--   dead                              -> declined  (old cross-off)
--   messaged/replied/negotiating      -> approved  (old outreach = I'm pursuing it)
--   new + reviewed_at set             -> approved  (old dashboard "keep" ✓ meant approve;
--                                                   this rescues listings that had nowhere to land)
update deal_radar set status = 'declined' where status = 'dead';
update deal_radar set status = 'approved' where status in ('messaged','replied','negotiating');
update deal_radar set status = 'approved' where status = 'new' and reviewed_at is not null;
