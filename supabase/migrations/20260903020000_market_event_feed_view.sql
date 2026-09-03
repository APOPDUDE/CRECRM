-- Feed view for the dashboard Market Monitor widget: every market event joined to
-- its owner-verification rollup, so the client can toggle "verified contacts only"
-- vs "all" and filter by category (event_type) in one query. security_invoker so
-- the VA-silo RLS on market_events + property_owner_rollup still applies per-user.
create or replace view v_market_event_feed
with (security_invoker = true) as
select
  me.id,
  me.event_type,
  me.source,
  me.event_date,
  me.property_id,
  me.county,
  me.address,
  me.city,
  me.title,
  me.url,
  me.status,
  me.first_seen_at,
  coalesce(r.owner_contact_verified, false) as owner_contact_verified,
  r.owner_name,
  r.best_contact_name,
  r.best_contact_phone
from market_events me
left join property_owner_rollup r on r.property_id = me.property_id;

grant select on v_market_event_feed to authenticated;
