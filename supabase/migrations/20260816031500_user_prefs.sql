-- Tiny cross-device preferences store (Alex, 2026-08-16: "add the prefs table so
-- presets sync to my phone"). One row per preference key, value is jsonb — the
-- export dialog's saved column presets are the first tenant ('export_presets').
-- Single-user today, so no per-user scoping; the standard authenticated policy
-- matches every other table (tightened per-owner later, same as the rest).
create table user_prefs (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table user_prefs enable row level security;
create policy user_prefs_auth_all on user_prefs
  for all to authenticated using (true) with check (true);
