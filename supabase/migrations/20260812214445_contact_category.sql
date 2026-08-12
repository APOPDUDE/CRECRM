-- Contacts had no category of their own: a person's type was inferred from whatever company
-- they hung off, so a contact with no company (Steve Townsend until today) read as nothing at
-- all. Same six words as company_type deliberately -- a contact and their company should not
-- speak different languages, and a filter should mean the same thing on both sides.
--
-- Nullable with no default on purpose. 9,659 existing contacts have never been categorised by
-- a human, and stamping them all 'other' would fabricate a judgement nobody made. NULL means
-- "nobody has said yet", which is the truth and is also the queue for the VA.
create type contact_category as enum
  ('landlord', 'owning_entity', 'tenant', 'broker', 'vendor', 'other');

alter table contacts add column if not exists category contact_category;

comment on column contacts.category is
  'What this person is to us. Mirrors company_type. NULL = not yet categorised by a human.';

create index if not exists contacts_category_idx on contacts(category) where category is not null;
