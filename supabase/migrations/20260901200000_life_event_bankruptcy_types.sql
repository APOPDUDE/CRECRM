-- 0053: three new market_event_type values for the distress expansion
-- (Alex 2026-09-01: probate/divorce + bankruptcy + tax delinquency).
--   life_event     — death certificate / probate filing / divorce judgment on a book owner
--   bankruptcy     — MDFL bankruptcy case naming a book owner (federal RSS)
--   tax_delinquent — tax-deed application (DR-512) recorded against a book parcel
alter type market_event_type add value if not exists 'life_event';
alter type market_event_type add value if not exists 'bankruptcy';
alter type market_event_type add value if not exists 'tax_delinquent';
