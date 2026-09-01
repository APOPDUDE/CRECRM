-- 0052: market_event_type += 'foreclosure' (pre-foreclosure tier, Alex 2026-09-01).
-- Source: Hillsborough Clerk ORI Public Access (OnBase PAV) — lis pendens recordings,
-- defendants matched against book owner names by the Mac distress worker.

alter type market_event_type add value if not exists 'foreclosure';
