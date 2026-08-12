-- Self storage is its own product, not "storage" in someone else's warehouse (Alex 2026-08-12).
--
-- The buyer roster could describe a cold-storage buyer and an IOS buyer but had no way to say
-- "buys self-storage facilities", so those buyers sat under whatever fit worst -- Saul Ii, who
-- owns self storage in Tampa, was filed under small_bay.
--
-- Slotted next to cold_storage rather than appended, so the coverage table on the Buyers page
-- reads in the order the products actually group.
--
-- Separate migration from the row it tags: Postgres will not let a new enum value be USED in the
-- same transaction that adds it.

alter type industrial_subclass add value if not exists 'self_storage' after 'cold_storage';
