-- STAGE 2b step A — the two defensible contact-placement fixes for the war-room
-- reconciliation (owners/owner_contacts retirement; contacts.company_id becomes the
-- ownership-coverage path).
--
-- (1) John Colman exists as TWO verified contact rows (a parked verified-duplicate pair,
--     different phone lines, same human). Both rows are CONFIRMED owner-people for BOTH of
--     his owning entities ("John P Colman And Linda L Coleman / Trustees", 0 properties, and
--     "Rental Properties Llc", 1 property) but both were seated at the Trustees company,
--     leaving 5409 S West Shore Blvd with no verified contact at its owning company.
--     Seat one row per entity: 813-839-3581 moves to Rental Properties Llc,
--     813-846-6031 stays at the Trustees. Uses only confirmed-link facts.
--
-- (2) Alex Fridy was seated at "Feeding Tampa Bay" (tenant row, 0 properties), which is the
--     operating name (DBA) of the owning entity "Tampa Bay Hunger Relief Center Inc" —
--     the same organization under two rows. Seat him at the entity row that owns
--     3624 Causeway Blvd. (Plausible-affiliation-duplicate rule.)
--
-- Both updates are guarded by the expected current seat, so they are idempotent and can
-- never misfire on replay.

update contacts
set company_id = 'bd0a0bf4-7e45-462d-9744-65965e561ee9'  -- Rental Properties Llc
where id = 'da8068ee-33a8-40d6-9686-9947168729ee'         -- John Colman (813-839-3581)
  and company_id = 'a674054b-2a4f-42aa-8c79-c1dcb52613ab'; -- was: John P Colman & Linda L Coleman / Trustees

update contacts
set company_id = '16aeb30f-7f4c-4523-b08c-72531cbef1c9'  -- Tampa Bay Hunger Relief Center Inc
where id = 'e1190f21-3c21-4065-b988-dc14697b7e38'         -- Alex Fridy
  and company_id = '0a2f718d-11a8-4694-93ea-d4c329a858d9'; -- was: Feeding Tampa Bay (DBA row)
