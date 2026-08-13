-- "Verified" needed somewhere to live. It was being inferred every time anyone asked, which is
-- why the book could not answer "who is real" without a five-way join.
--
-- NOT overloaded onto decision_maker. That column means "is this person the one who decides for
-- their company", and v_lease_comps publishes it as dm_verified on every comp -- stamping 1,056
-- responders into it would make that column lie. Verified means "we know this person exists and
-- reached them"; decision maker is a separate claim about authority.
--
-- Mirrors owner_contacts.verified_at / verified_by, already the house pattern one table over.
alter table contacts add column if not exists verified_at timestamptz;
alter table contacts add column if not exists verified_by text;

comment on column contacts.verified_at is
  'When this person was confirmed real: they responded to us, became a client, or are tied to a verified owner. NULL = not established.';
comment on column contacts.verified_by is
  'What established it — response | client | verified_owner | va | alex.';

create index if not exists contacts_verified_idx on contacts(verified_at) where verified_at is not null;

-- Backfill, run 2026-08-12. 1,056 contacts marked; of those 274 were archived despite being
-- verified and were un-archived (pre-image: _rollback_contacts_verified_20260812).
-- An owner_contacts link to an UNVERIFIED owner is deliberately NOT evidence -- 5,144 contacts
-- carry one and it is a skip-trace guess, not a person.
