-- Market Monitor feed v2: carry the property's use (CRM kind + county DOR code) so the
-- dashboard widget and the page can tag each event "Vacant industrial" / "Warehouse" and
-- filter by use, plus the event detail so the page can read the view instead of the table.
-- Columns are appended (CREATE OR REPLACE VIEW rule). security_invoker stays on: the VA
-- silo's RLS applies through the view.
create or replace view public.v_market_event_feed with (security_invoker = true) as
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
  r.best_contact_phone,
  p.property_type,
  p.dor_use_code,
  me.detail,
  me.source_key,
  me.parcel_number
from public.market_events me
left join public.property_owner_rollup r on r.property_id = me.property_id
left join public.properties p on p.id = me.property_id;

comment on view public.v_market_event_feed is
  'Market Monitor feed: market_events + owner verification + property use. security_invoker.';
