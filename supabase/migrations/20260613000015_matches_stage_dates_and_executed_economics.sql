-- Stage-move popups capture a date for each stage (and full economics on Executed),
-- which feed the dashboard activity chart. tour_date / execution_date already exist;
-- this adds the scheduled tour timestamp (date+time for the calendar), the remaining
-- stage dates, and executed-deal economics captured on the match.
alter table matches
  add column tour_at timestamptz,                 -- scheduled tour date+time (calendar)
  add column loi_date date,                        -- when the LOI was sent
  add column lease_negotiation_date date,          -- entered lease/PSA negotiation
  add column executed_rate_psf numeric(10,2),      -- executed $/SF/yr
  add column executed_price numeric(14,2),         -- executed sale price
  add column lease_structure lease_structure,      -- NNN | NN | MG
  add column escalations text,
  add column ti_psf numeric(10,2),
  add column term_months integer,
  add column free_rent_months numeric(5,1);
