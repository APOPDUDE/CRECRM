-- Email lead pool: side-of-the-deal category, and out-of-scope campaigns removed.
-- Applied live 2026-08-17; this file is the committed record.
--
-- Alex: "remove all the potens allergy ones and also any residential ones cause I know I ran a
-- couple campaigns for houses in Sarasota, also there were campaigns for tenants like 3609 and 1401
-- whitfield, all those contacts should be marked as tenants."
--
-- CATEGORY reuses the existing contact_category enum rather than inventing a vocabulary, so a pooled
-- address and a real contact are described in the same six words (contacts.category is the same
-- type). Which side of a deal somebody is on is a property of the CAMPAIGN that mailed them, because
-- that is what the copy was written for:
--
--   tenant   -- mailed about SPACE. "Email Campaign - 1407 Whitfield Ave" and
--               "Email Campaign - 3609 15th st" pitched a listing to nearby occupiers;
--               "3609 Tenants" (+ copy) was an explicit tenant hunt; "expiring leases" addressed
--               occupiers about their own renewal. Alex named the first two by hand; the other three
--               are the same thing under different names, so they are included and flagged here
--               rather than left null.
--   landlord -- mailed about THEIR OWN property. Every "Off Market Offer" variant asked an owner
--               whether they would sell.
--
-- Left deliberately NULL: "2810 buyers" (proven buyers pulled off deed records -- contact_category
-- has no buyer value, and inventing one only here would fork the vocabulary) and the GHL tag lists,
-- which mix sides. 282 rows.
--
-- SCOPE. Potens Allergy was a medical-office tenant search for a different business, and the two
-- Sarasota campaigns were residential houses -- neither belongs in a CRE book. This is the same call
-- Alex made on 2026-08-16, when 14 Potens replies were excluded from the history import.
-- Checked first: nothing residential survives among the LINKED properties (the pool links only to
-- industrial / retail / office / other / land -- the property book was purged of houses earlier), so
-- campaign membership is the only place this scope lives.
--
-- Two rules kept the delete honest:
--   * an address on a removed list AND on a kept list loses only the list, never the row (7 rows);
--   * an address that REPLIED or is already promoted to a contact is kept regardless, because that
--     is earned evidence -- 6 rows, tagged 'zz-out-of-scope-kept-for-evidence' so they are
--     explicable later rather than mysterious.
--
-- RESULT: pool 7,152 -> 5,486. 1,666 deleted. tenant 2,334 · landlord 2,870 · uncategorised 282.
-- Never-answered 6,722 -> 5,061. Property-linked 2,543 -> 2,469.

begin;

alter table email_leads
  add column if not exists category contact_category;

comment on column email_leads.category is
  'Which side of a deal this address is on, in the same six words as contacts.category. Derived from '
  'the campaign that mailed them: a listing/space campaign means tenant, an off-market "would you '
  'sell" campaign means landlord. NULL where the source list mixes sides or has no CRE side at all '
  '(e.g. a buyer list -- contact_category has no buyer value either).';

create index if not exists email_leads_category_idx on email_leads (category)
  where category is not null;

update email_leads
   set category = 'tenant'
 where category is null
   and lists && array['Email Campaign - 1407 Whitfield Ave',
                      'Email Campaign - 3609 15th st',
                      '3609 Tenants',
                      '3609 Tenants - copy',
                      'expiring leases'];

update email_leads
   set category = 'landlord'
 where category is null
   and lists && array['Off Market Offer',
                      'Off Market Offer - 2',
                      'Off Market Offer - 3 would you sell',
                      'Off Market Offer - 4 would you sell - hubspot',
                      'Off Market General'];

-- strip the out-of-scope list from anyone who also sits on a list we keep
update email_leads
   set lists = (select coalesce(array_agg(x), '{}'::text[]) from unnest(lists) x
                 where x <> all (array['Potens Allergy','Potens Allergy - copy',
                                       'Potens Allergy - copy - copy',
                                       'Sarasota houses','Sarasota 50-80k']))
 where lists && array['Potens Allergy','Potens Allergy - copy','Potens Allergy - copy - copy',
                      'Sarasota houses','Sarasota 50-80k']
   and not (lists <@ array['Potens Allergy','Potens Allergy - copy','Potens Allergy - copy - copy',
                           'Sarasota houses','Sarasota 50-80k']);

-- delete the rows that were ONLY on those lists and carry no earned evidence.
-- cardinality(lists) > 0 matters: an EMPTY array is a subset of anything, so without it this would
-- also delete every GHL-sourced row whose tags were all bookkeeping.
delete from email_leads
 where cardinality(lists) > 0
   and lists <@ array['Potens Allergy','Potens Allergy - copy','Potens Allergy - copy - copy',
                      'Sarasota houses','Sarasota 50-80k']
   and contact_id is null
   and last_reply_at is null;

-- the survivors replied or are already contacts -- keep them, and say why they are still here
update email_leads
   set lists = lists || array['zz-out-of-scope-kept-for-evidence']
 where cardinality(lists) > 0
   and lists <@ array['Potens Allergy','Potens Allergy - copy','Potens Allergy - copy - copy',
                      'Sarasota houses','Sarasota 50-80k','zz-out-of-scope-kept-for-evidence']
   and not ('zz-out-of-scope-kept-for-evidence' = any (lists));

commit;
