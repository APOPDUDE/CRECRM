-- Put the buyers who already told us they're in self storage under the new tag (Alex 2026-08-12).
--
-- Audit, not a keyword sweep. Every place a buyer's story is written down -- must_haves,
-- intended_use, contact/company notes, the notes log and call transcripts -- was searched across
-- the whole roster for self storage, mini storage, storage facilities/units. **One buyer matched.**
--
-- Saul Ii: "Has self storage in Tampa" (must_haves) and "Only has self storage called about
-- Nicoles search" (note). Tagged, keeping small_bay -- that was set deliberately today and owning
-- self storage does not stop him buying small bay.
--
-- Three other buyers say "storage" and are deliberately NOT tagged; the word is doing a different
-- job in each, and tagging them would feed the matching engine deals they don't want:
--   * Gregory Pelini  -- "blank shell space to build out for storage", an extension of his own
--                        factory. He wants a building, not a storage business.
--   * Owen            -- "a little outdoor storage for deliveries". That's yard, i.e. IOS.
--   * Seder           -- "needs cold storage for his food distribution company". Already its own
--                        subclass, and a refrigerated warehouse is not a self-storage facility.

update clients
set product_subclasses = array_append(product_subclasses, 'self_storage'::industrial_subclass)
where id = '3af5f61b-c677-4625-b85b-a4fcc0481e64'
  and not (product_subclasses @> array['self_storage'::industrial_subclass]);
