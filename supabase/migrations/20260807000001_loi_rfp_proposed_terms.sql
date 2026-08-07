-- LOI / RFP proposed deal terms live on the deal itself. The Draft LOI / Draft RFP
-- buttons read and write these columns, so every generated document doubles as data
-- capture — no separate loi table, the pursuit IS the term sheet.

-- Lease-side proposed terms
alter table pursuits add column proposed_sf integer;
alter table pursuits add column proposed_rate_psf numeric(10,2);
alter table pursuits add column proposed_lease_structure lease_structure;
alter table pursuits add column proposed_opex_psf numeric(10,2);
alter table pursuits add column lease_term_months integer;
alter table pursuits add column proposed_commencement date;
alter table pursuits add column escalation_pct numeric(5,2);
alter table pursuits add column free_rent_months integer;
alter table pursuits add column ti_allowance_psf numeric(10,2);
alter table pursuits add column security_deposit numeric(14,2);
alter table pursuits add column renewal_terms text;
alter table pursuits add column special_provisions text;

-- Sale-side proposed terms (purchase LOI)
alter table pursuits add column proposed_price numeric(14,2);
alter table pursuits add column earnest_deposit numeric(14,2);
alter table pursuits add column dd_days integer;
alter table pursuits add column closing_days integer;

alter table pursuits add constraint pursuits_proposed_terms_positive check (
  (proposed_sf is null or proposed_sf > 0)
  and (proposed_rate_psf is null or proposed_rate_psf > 0)
  and (lease_term_months is null or lease_term_months > 0)
  and (free_rent_months is null or free_rent_months >= 0)
  and (proposed_price is null or proposed_price > 0)
  and (dd_days is null or dd_days > 0)
  and (closing_days is null or closing_days > 0)
);

-- What the tenant will use the premises for — the LOI's "Use of Premises" line,
-- kept as client data (it is also matching signal).
alter table clients add column intended_use text;

-- Generated RFPs get their own file category (LOIs already have one).
alter type file_category add value if not exists 'rfp';
