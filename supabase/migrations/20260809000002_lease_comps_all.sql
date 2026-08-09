-- Every executed lease comp, not just the ones still running.
--
-- Supersedes v_lease_expirations, which required an expiration date and so answered
-- only "what is coming available". Pricing a building asks the opposite question --
-- what has recently been signed around here, at what rate -- and for that an expired
-- comp is the point, not noise. The old view also silently dropped the 37 comps that
-- know when they were signed but not when they end.
--
-- Two signed month-distances, pointing opposite ways:
--   months_to_expiry    - negative once the lease has run out
--   months_since_signed - positive for a lease signed in the past
-- Either may be null when its date is unknown; callers filter rather than assume.
--
-- security_invoker so the caller's RLS applies; a view over comps must not become a
-- side door around the policies on comps and properties.

drop view if exists v_lease_expirations;

create or replace view v_lease_comps
with (security_invoker = true) as
select
  c.id                     as comp_id,
  c.property_id,
  c.tenant_name,
  c.sf,
  c.executed_lease_rate_psf,
  c.lease_structure,
  c.term_months,
  c.commencement_date,
  c.expiration_date,
  c.executed_at            as signed_date,
  (c.expiration_date - current_date) as days_to_expiry,
  -- Whole months, floored. age() is already signed against a past date, so it needs no
  -- help to go negative -- an explicit sign flip would turn every expired lease future.
  --
  -- Clamped below at -1 for anything already past, because the raw month difference
  -- rounds a lease that ran out two weeks ago to 0 -- which would file it under
  -- "expiring within a month" alongside leases that have not ended yet.
  case
    when c.expiration_date is null then null
    when c.expiration_date < current_date then
      least(-1, (date_part('year',  age(c.expiration_date, current_date)) * 12
                 + date_part('month', age(c.expiration_date, current_date)))::int)
    else (date_part('year',  age(c.expiration_date, current_date)) * 12
          + date_part('month', age(c.expiration_date, current_date)))::int
  end                      as months_to_expiry,
  -- Mirror image: months elapsed since signing. Positive means in the past, so
  -- "signed within the last year" is 0..12. A handful of rows carry a forward-dated
  -- signature and come back negative rather than being quietly rounded to zero.
  case
    when c.executed_at is null then null
    else (date_part('year',  age(current_date, c.executed_at)) * 12
          + date_part('month', age(current_date, c.executed_at)))::int
  end                      as months_since_signed,
  p.address,
  p.city,
  p.state,
  p.county,
  p.lat,
  p.lng,
  p.building_sf,
  p.land_acres,
  p.property_type
from comps c
join properties p on p.id = c.property_id
where c.deal_type = 'lease'
  and c.kind = 'executed';

comment on view v_lease_comps is
  'Every executed lease comp joined to its parcel. months_to_expiry is negative once '
  'the lease has run out; months_since_signed is positive for a lease signed in the '
  'past. Either is null when the underlying date is unknown.';
