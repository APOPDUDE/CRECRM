-- Lease expirations as a first-class lens.
--
-- Every executed lease comp carries an expiration date, so the book already knows
-- which buildings come available and when — it just had no way to ask. This view is
-- that question: one row per lease, joined to the parcel so the War Room can map it
-- and filter on building size / land the same way the market layer does.
--
-- Expired leases stay in. A lease that ran out three months ago is a call worth
-- making (did they renew? did they leave?), so months_to_expiry is signed and the
-- caller decides the window rather than the view deciding for them.
--
-- security_invoker so the caller's RLS applies; a view over comps must not become a
-- side door around the policies on comps and properties.

create or replace view v_lease_expirations
with (security_invoker = true) as
select
  c.id                     as comp_id,
  c.property_id,
  c.tenant_name,
  c.sf,
  c.executed_lease_rate_psf,
  c.lease_structure,
  c.commencement_date,
  c.expiration_date,
  (c.expiration_date - current_date) as days_to_expiry,
  -- Whole months, floored: a lease 45 days out is "1 month", not "2". age() is already
  -- signed against a past date, so it needs no help to go negative -- an explicit
  -- sign flip here would turn every expired lease into a future one.
  --
  -- Clamped below at -1 for anything already past, because the raw month difference
  -- rounds a lease that ran out two weeks ago to 0 -- which would file it under
  -- "expiring within a month" alongside leases that have not ended yet.
  case
    when c.expiration_date < current_date then
      least(-1, (date_part('year',  age(c.expiration_date, current_date)) * 12
                 + date_part('month', age(c.expiration_date, current_date)))::int)
    else (date_part('year',  age(c.expiration_date, current_date)) * 12
          + date_part('month', age(c.expiration_date, current_date)))::int
  end                      as months_to_expiry,
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
  and c.kind = 'executed'
  and c.expiration_date is not null;

comment on view v_lease_expirations is
  'One row per executed lease comp with a known expiration, joined to its parcel. '
  'months_to_expiry is signed: negative means the lease has already run out.';
