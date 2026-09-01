-- "In person" as a lead source (meetings, walk-ins, someone flagging Alex down at a
-- property). Add-only; the app's sourceConfig map gains the label in the same commit.
-- Kept separate from any migration that USES the value - ALTER TYPE ADD VALUE cannot
-- be referenced inside the same transaction.
alter type public.lead_source add value if not exists 'in_person' after 'cold_call';
