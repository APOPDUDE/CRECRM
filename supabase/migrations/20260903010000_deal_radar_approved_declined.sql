-- Deal Radar status model: approve / decline buckets.
--
-- The human triages a listing to one of two visible buckets — approved (I'm
-- pursuing it: messaged the owner / want a deal) or declined (I passed). This
-- replaces the old "dead" cross-off and the messaged/replied/negotiating
-- outreach sub-states, which nobody drove by hand. 'converted' still marks a
-- listing turned into a real CRM deal (via Create deal) and shows inside the
-- Approved bucket. Enum values must be added in their own statement before any
-- later migration can use them.
alter type deal_radar_status add value if not exists 'approved';
alter type deal_radar_status add value if not exists 'declined';
