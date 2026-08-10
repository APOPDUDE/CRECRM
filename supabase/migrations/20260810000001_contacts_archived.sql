-- Contacts: archive flag.
--
-- The HubSpot/skip-trace imports left the book ~70% padding: rows whose only
-- claim to existence is an unverified skip-trace guess. A phone number is NOT
-- evidence a contact is real (most numbers came from bulk skip tracing).
--
-- A contact is REAL when there is relationship evidence: a client or listing
-- link, a CONFIRMED owner_contacts row, a note, a prospect row, an actual
-- conversation (a communications row with a transcript/body, not merely an
-- attempted call), a file, or a task. Everything else is prospecting-list
-- material and gets archived.
--
-- Archived, not deleted: the rows still back comps, owner guesses and campaign
-- history, and a delete would cascade or block on FKs. The UI filters them out.

alter table contacts
  add column if not exists archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_reason text;

-- Partial index: every list view filters to the live book, which is the minority.
create index if not exists contacts_live_idx on contacts (id) where archived = false;

comment on column contacts.archived is
  'True = prospecting-list padding with no relationship evidence; hidden from the UI. See 20260810000001.';
