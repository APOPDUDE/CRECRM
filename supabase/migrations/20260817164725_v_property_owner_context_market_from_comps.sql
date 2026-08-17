-- R7 repoint: v_property_owner_context's market lateral drops its p.listed_at
-- read — the asking comps carry the same signal (every scrape now mints one,
-- and 20260816090000 seeded comps for the pre-R7 comp-less listings, comp
-- listed_at included). Column names, types and order unchanged; only the mkt
-- lateral's sources move, so CREATE OR REPLACE suffices.
--
-- was_on_market:    last_seen_in_sweep | any asking comp        (was: | p.listed_at)
-- off_market_since: greatest(last_seen, max as_of, max listed)  (was: p.listed_at)

create or replace view public.v_property_owner_context as
select
  p.id as property_id,
  null::uuid as owner_id,
  c.name as owner_name,
  c.entity_kind as owner_kind,
  c.mailing_address as owner_mailing_address,
  case
    when c.id is null then null
    when coalesce(oc.confirmed_count, 0::bigint) > 0 then 'verified'
    when c.exported_at is not null then 'exported'
    else 'unverified'
  end as owner_verification_status,
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
  select p.last_seen_in_sweep is not null or ask.latest is not null or ask.listed is not null as was_on_market,
         greatest(p.last_seen_in_sweep::date, ask.latest, ask.listed) as off_market_since
  from (select max(cx.as_of_date) as latest, max(cx.listed_at) as listed
        from comps cx
        where cx.property_id = p.id and cx.kind = 'asking'::comp_kind) ask
) mkt on true
left join lateral (
  select nullif(btrim((ct.first_name || ' '::text) || coalesce(ct.last_name, ''::text)), ''::text) as contact_name,
         ct.phone,
         ct.email,
         ct.email_verified_at,
         case when ct.verified_at is not null then 'confirmed' else 'likely' end as confidence
  from contacts ct
  where ct.company_id = p.owner_company_id
    and not ct.do_not_call
  order by (ct.verified_at is null), (ct.email_verified_at is null), (ct.phone is null), (ct.email is null)
  limit 1
) best on p.owner_company_id is not null;
