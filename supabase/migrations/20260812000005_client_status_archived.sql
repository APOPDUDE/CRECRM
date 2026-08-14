-- A search that ended is not a search you lost (Alex 2026-08-12).
--
-- An owner-user finds their building. A 1031 buyer's clock runs out. Either way they should come
-- off the roster, the blast lists and the matching engine — but calling that `lost` is wrong (we
-- didn't lose them to anybody) and `closed` is wrong too (there was no deal). Both would also read
-- as a judgement on the relationship in six months' time when they call again.
--
-- So: `archived`. Off the board, kept whole, and reachable through the Archived filter.
--
-- It lands OUTSIDE `uq_active_client_per_contact` (prospect/searching/negotiating), which is the
-- point that makes this safe: archiving frees the contact's one-active-client slot, so the same
-- person can be added as a buyer again when their next search starts, and
-- mark_contact_as_buyer/intake_buyer_tag will queue them rather than reporting already_a_client.
--
-- Separate migration from anything that USES the value: Postgres will not accept both in one
-- transaction.

alter type client_status add value if not exists 'archived' after 'lost';
