-- 0047: index find_property()'s try 3 — normalize_parcel(parcel_number).
-- The fn's UNION ALL evaluates every branch on every call, and try 3 had no expression
-- index, so EVERY find_property call seq-scanned ~119k properties (surfaced when
-- import_market_events called it per event and blew the statement timeout on run 1).
-- Full index, not partial: the planner can't prove parcel_number IS NOT NULL from
-- normalize_parcel(parcel_number) = $x, so a partial index would never be chosen.

create index if not exists properties_parcel_norm_idx
  on properties (normalize_parcel(parcel_number));
