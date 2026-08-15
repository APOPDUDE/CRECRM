-- STAGE 2b (B): v_property_owner_context re-sourced from companies + contacts.
--
-- Output columns 1..26 keep their exact names and types (the deployed bundle and
-- map_properties/search_map_properties read this view); owner_company_id is APPENDED as
-- column 27 — to_jsonb() in the map RPCs carries it through, and the repointed app keys
-- the owner card on it.
--
-- Semantics after the retirement:
--   owner_*                    = the companies row behind properties.owner_company_id
--   owner_verification_status  = 'verified' when a verified_at contact is seated at the
--                                owning company; else 'exported' when companies.exported_at
--                                is stamped; else 'unverified'; NULL when no owning company.
--   confirmed contact          = contact with verified_at (the confidence ladder is retired);
--                                best_contact_confidence maps verified -> 'confirmed',
--                                else 'likely', still typed owner_contact_confidence.
--   comm block                 = communications matched on property_id OR owner_company_id.
--   owner_id (column 2)        = properties.owner_id, passed through untouched for the
--                                still-deployed bundle. No owners/owner_contacts reference
--                                remains anywhere in the view; when properties.owner_id is
--                                dropped in the final retirement migration this one output
--                                line must be replaced (e.g. null::uuid) in the same
--                                migration.
--
-- Reconciliation state at rewrite time (step-A measurement, after the two seat fixes):
-- old confirmed 573 / reachable 610 -> new 658 / 658. The residue is documented in the
-- stage-2b report: 9 properties lost to genuine dual-affiliation people, 1 reachable lost
-- to a likely-link email, 94/58 gained from response-verified people seated at owning
-- companies by the stage-1/2a backfill.

create or replace view public.v_property_owner_context as
select
  p.id as property_id,
  p.owner_id,
  c.name as owner_name,
  c.entity_kind as owner_kind,
  c.mailing_address as owner_mailing_address,
  (case
     when c.id is null then null
     when coalesce(oc.confirmed_count, 0::bigint) > 0 then 'verified'
     when c.exported_at is not null then 'exported'
     else 'unverified'
   end)::owner_verification_status as owner_verification_status,
  coalesce(port.property_count, 0::bigint) as owner_property_count,
  port.portfolio_sf as owner_portfolio_sf,
  port.portfolio_acres as owner_portfolio_acres,
  coalesce(oc.contact_count, 0::bigint) as owner_contact_count,
  coalesce(oc.confirmed_count, 0::bigint) as owner_confirmed_contact_count,
  coalesce(oc.confirmed_count, 0::bigint) > 0 as owner_contact_verified,
  coalesce(oc.email_verified_count, 0::bigint) > 0 as owner_email_verified,
  coalesce(oc.confirmed_count, 0::bigint) > 0 or coalesce(oc.email_verified_count, 0::bigint) > 0 as owner_reachable,
  coalesce(oc.do_not_call_count, 0::bigint) > 0 as owner_do_not_call,
  comm.comm_count,
  comm.last_contacted_at,
  mkt.was_on_market,
  mkt.off_market_since,
  case
    when p.listing_status = 'off_market'::listing_market_status and mkt.was_on_market
      then current_date - mkt.off_market_since
    else null::integer
  end as off_market_days,
  best.contact_name as best_contact_name,
  best.phone as best_contact_phone,
  best.email as best_contact_email,
  best.confidence as best_contact_confidence,
  best.email_verified_at as best_contact_email_verified_at,
  c.tags as owner_tags,
  p.owner_company_id
from properties p
left join companies c on c.id = p.owner_company_id
left join lateral (
  select count(*) as property_count,
         sum(p2.gross_sf) as portfolio_sf,
         sum(p2.land_acres) as portfolio_acres
  from properties p2
  where p2.owner_company_id = p.owner_company_id
) port on p.owner_company_id is not null
left join lateral (
  select count(*) as contact_count,
         count(*) filter (where ct.verified_at is not null) as confirmed_count,
         count(*) filter (where ct.email_verified_at is not null) as email_verified_count,
         count(*) filter (where ct.do_not_call) as do_not_call_count
  from contacts ct
  where ct.company_id = p.owner_company_id
) oc on p.owner_company_id is not null
left join lateral (
  select count(*) as comm_count,
         max(cm.occurred_at) as last_contacted_at
  from communications cm
  where cm.property_id = p.id
     or (p.owner_company_id is not null and cm.owner_company_id = p.owner_company_id)
) comm on true
left join lateral (
  select p.last_seen_in_sweep is not null or p.listed_at is not null or ask.latest is not null as was_on_market,
         greatest(p.last_seen_in_sweep::date, ask.latest, p.listed_at) as off_market_since
  from (select max(cx.as_of_date) as latest
        from comps cx
        where cx.property_id = p.id and cx.kind = 'asking'::comp_kind) ask
) mkt on true
left join lateral (
  select nullif(btrim((ct.first_name || ' '::text) || coalesce(ct.last_name, ''::text)), ''::text) as contact_name,
         ct.phone,
         ct.email,
         ct.email_verified_at,
         (case when ct.verified_at is not null then 'confirmed' else 'likely' end)::owner_contact_confidence as confidence
  from contacts ct
  where ct.company_id = p.owner_company_id
    and not ct.do_not_call
  order by (ct.verified_at is null), (ct.email_verified_at is null), (ct.phone is null), (ct.email is null)
  limit 1
) best on p.owner_company_id is not null;
