-- Jeff Sitoman's search is over (Alex 2026-08-12) — the first use of `archived`.
--
-- A 1031 investor with no deadline recorded, so nothing was going to age him off the roster on
-- its own. Archiving frees his contact's active-client slot, so if he starts another exchange he
-- can simply be added as a buyer again.

update clients set status = 'archived'
where id = 'ab521235-5434-434c-945f-d7bfaf8a6d17' and status <> 'archived';
