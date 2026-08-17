-- Legacy load: the email_leads pool moves onto the outreach spine.
--
-- Alex's call (plan-outreach-spine.md 2026-08-17): of the 5,487 Smartlead-era rows, keep ONLY
-- those confidently attached to a property (2,469) -- they become spine targets with their email
-- channel state intact. The rest don't fit the model and he'd rather not lose them than force
-- them in: the WHOLE pool is snapshotted to email_leads_archive first, so nothing is lost.
--
-- Mechanics:
--   * Targets reuse the email_leads uuid, so the channel children join without a mapping table.
--   * email_leads was keyed per ADDRESS; the spine is keyed per PERSON. Rows sharing a phone
--     carry different emails by construction (5,487 rows, 5,487 distinct emails), so under the
--     shared-phone guard they stay SEPARATE targets: the first row (by created_at) keeps the
--     calls row, later ones are flagged shared_phone_conflicting_email for a human merge pass.
--     (~1,295 duplicate humans were measured hiding in the pool -- flagged, never auto-merged.)
--   * lists are carried minus GHL STATUS tags (owner-verified, interested, not interested,
--     wrong person, buyer*, owner occupier, zz-*) -- those are outcomes, not audiences. The
--     nicole variants collapse to list-nicole and "2810 buyers" becomes list-2810, matching the
--     names the GHL loads use.
--   * A 'wrong person' GHL tag does NOT set wrong_person_at: per the 08-17 ruling it recorded
--     "wrong person for the PHONE we dialled", which is a wrong NUMBER and says nothing about
--     the email address.

begin;

create table email_leads_archive as table email_leads;

comment on table email_leads_archive is
  'Frozen 2026-08-17 pre-image of the email_leads pool, taken when the outreach spine replaced '
  'it. The 2,469 property-linked rows also moved into outreach_targets/outreach_email; the rest '
  'live only here. Read-only history -- nothing writes or reads this in the app.';

-- ------------------------------------------------------------------ spine rows
with keepers as (
  select l.*,
         normalize_phone(l.phone) as np,
         row_number() over (partition by normalize_phone(l.phone)
                            order by l.created_at, l.id) as phone_rank
  from email_leads l
  where l.property_id is not null
)
insert into outreach_targets
  (id, first_name, last_name, name_source, company_name, phone, email,
   property_id, parcel_id, contact_id, lists, source, hold_reason, raw, created_at)
select
  k.id, k.first_name, k.last_name, k.name_source, k.company_name, k.phone, k.email,
  k.property_id, k.parcel_id, k.contact_id,
  (select coalesce(array_agg(distinct case
       when x.x in ('list-nicole-verified-contacts-already','list-nicole-x2') then 'list-nicole'
       when x.x = '2810 buyers' then 'list-2810'
       else x.x end), '{}'::text[])
     from unnest(k.lists) as x(x)
    where x.x not in ('owner-verified','not interested','interested','wrong person',
                      'buyer','buyer-queued','owner occupier','zz-out-of-scope-kept-for-evidence')),
  k.source,
  case when k.np is not null and k.phone_rank > 1 then 'shared_phone_conflicting_email' end,
  k.raw, k.created_at
from keepers k;

-- ------------------------------------------------------------------ email channel
insert into outreach_email
  (target_id, email, email_status, email_status_at, sent_count, last_sent_at,
   last_campaigned_at, last_reply_at, reply_category, bounced_at, opted_out_at, created_at)
select
  l.id, l.email, l.email_status, l.email_status_at, l.sent_count, l.last_sent_at,
  l.last_campaigned_at, l.last_reply_at, l.reply_category, l.bounced_at, l.opted_out_at,
  l.created_at
from email_leads l
where l.property_id is not null;

-- ------------------------------------------------------------------ phone channel
-- One calls row per NUMBER, owned by the earliest target that carried it.
with keepers as (
  select l.id, l.phone,
         normalize_phone(l.phone) as np,
         row_number() over (partition by normalize_phone(l.phone)
                            order by l.created_at, l.id) as phone_rank
  from email_leads l
  where l.property_id is not null and normalize_phone(l.phone) is not null
)
insert into outreach_calls (target_id, phone)
select k.id, k.phone from keepers k where k.phone_rank = 1;

commit;
