-- 0051: market_event_type += 'code_enforcement' (distress tier, Alex 2026-09-01).
-- Sources: HC CodeEnforcementCasesMapService layers 0/1/3 (cases, condemnations, liens)
-- via the Mac distress fetchers. 'foreclosure' / 'probate' get their values when their
-- sources actually ship (enum values are forever — add only what's ingesting).

alter type market_event_type add value if not exists 'code_enforcement';
