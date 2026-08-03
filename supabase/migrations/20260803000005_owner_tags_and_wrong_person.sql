-- Owner-level outcome tags + first-class wrong_person (Alex 2026-08-03, the Helena Cao case:
-- company name mis-parsed as a person survived every prior filter).
--
-- * owners.tags text[] -- conversation outcomes (interested / not interested / ...) recorded
--   as data, appended by the GHL flow, shown on the owner card, exported as "Owner Tags".
--   Backfilled from the "[GHL tag: ...]" notes the flow had already filed.
-- * v_property_owner_context exposes owner_tags (appended column).
-- * ghl_verify_owner v4 (applied live; full body in the live DB):
--     - status 'wrong_person' (also accepts 'wrong person'): unlinks the disproven
--       owner<->contact pairing (contact + history survive), files "[GHL tag: wrong person]"
--       as a communication, recomputes the owner's verified flag honestly.
--     - verified path appends p->>'tag' into owners.tags (distinct).
-- * n8n wrong-person branch now calls ghl-verify BEFORE deleting the GHL contact, so the
--   outcome lands in Supabase, not just as a GHL deletion.
-- * 2405 N 71st St: "Helena Cao" link removed, outcome filed, Helena Chemical Co owner
--   dropped to unverified.
alter table owners add column if not exists tags text[];
comment on column owners.tags is
  'Outcome tags from conversations (interested / not interested / ...), appended by the GHL '
  'verification flow. Owner-level sentiment, distinct from pipeline verification_status.';

update owners o
set tags = sub.tags
from (
  select cm.owner_id, array_agg(distinct lower(substring(cm.body from '\[GHL tag: ([^\]]+)\]'))) as tags
  from communications cm
  where cm.source = 'ghl' and cm.body like '[GHL tag: %' and cm.owner_id is not null
  group by cm.owner_id
) sub
where o.id = sub.owner_id and o.tags is null;

-- (view + function bodies as applied live 2026-08-03 -- see migration history in Supabase;
-- kept out of this file only to avoid a third full copy drifting from the applied one.)
