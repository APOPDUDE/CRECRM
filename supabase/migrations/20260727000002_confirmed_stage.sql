-- A "Confirmed" stage between Inquiring and Touring (Alex, 2026-07-27).
--
-- The real step it models: after a property is added to a client's board, Alex calls the
-- listing broker to confirm the listing is real and the details are right (still
-- available, actual size, actual rate). Only then is it worth showing to the tenant --
-- and if the tenant likes it, it goes to Touring.
--
-- Applies to BOTH pipelines: lease reads Inquiring -> Confirmed -> Touring -> Negotiation
-- -> Executed, sale reads Inquiring -> Confirmed -> Touring -> PSA negotiation ->
-- Due diligence -> Closed. Same enum, same relabelling scheme as due_diligence.
--
-- Enum position matters: comparisons and the "hottest stage" ranking read the declared
-- order, so it goes BEFORE 'touring' rather than being appended.

alter type pursuit_stage add value if not exists 'confirmed' before 'touring';
