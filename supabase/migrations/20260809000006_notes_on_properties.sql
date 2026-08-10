-- Notes can hang on a property.
--
-- Separate migration from 20260809000005 because Postgres will not let a transaction use
-- an enum value it just added, and the tour note this column exists to hold is written
-- with kind = 'tour'.
--
-- Until now a note could hang on a contact, a client, a listing or a pursuit — every one
-- of them a DEAL. Nothing could be said about a building itself, so a tenant touring an
-- address and walking away left no trace an unrelated future deal would ever see.
--
-- pursuit_id stays set alongside it: property_id says which building the note is about,
-- pursuit_id says which deal produced it, and the property page shows both.

alter table notes
  add column if not exists property_id uuid references properties(id) on delete cascade;

create index if not exists notes_property_idx on notes(property_id, created_at desc);

comment on column notes.property_id is
  'The building this note is about. Set alongside pursuit_id for tour feedback, so a '
  'note surfaced on the property can still name the deal that produced it.';
