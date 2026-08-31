-- 0048: dashboard alerts for verified-contact properties + 2026-08-31 audit fixes.

-- ── Dashboard alert rule (lives in Postgres, foundation rule 1) ──────────────
-- A market event deserves the dashboard when it is NEW and its property's owner
-- has a verified contact (property_owner_rollup.owner_contact_verified — the
-- precomputed rollup the War Room already trusts). SECURITY INVOKER on purpose:
-- RLS runs as the caller, so the VA silo's restrictive policies make this
-- return zero rows for a VA login with no extra guard needed.
create or replace function market_event_alerts(p_limit int default 20)
returns table (
  event_id uuid,
  event_type market_event_type,
  title text,
  url text,
  event_date date,
  first_seen_at timestamptz,
  property_id uuid,
  address text,
  city text,
  owner_name text,
  contact_name text,
  contact_phone text
)
language sql stable
set search_path = public
as $$
  select me.id, me.event_type, me.title, me.url, me.event_date, me.first_seen_at,
         p.id, coalesce(p.site_address, p.address), p.city,
         r.owner_name, r.best_contact_name, r.best_contact_phone
  from market_events me
  join properties p on p.id = me.property_id
  join property_owner_rollup r on r.property_id = p.id and r.owner_contact_verified
  where me.status = 'new'
  order by me.first_seen_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

revoke all on function market_event_alerts(int) from public, anon;
grant execute on function market_event_alerts(int) to authenticated, service_role;

-- ── Audit fix: the ingest door is machine-only ───────────────────────────────
-- import_market_events is SECURITY DEFINER and returns book associations
-- (property ids + titles); nothing in the app calls it — only n8n / the Mac via
-- service_role. Same reasoning as ghl_verified_drift: a definer fn a VA login
-- could reach through PostgREST must not exist.
revoke execute on function import_market_events(jsonb) from authenticated;

-- ── Audit fix: five tables had RLS DISABLED (advisor ERRORs) ─────────────────
-- All are SQL-era scratch/archive with zero app references (checked 2026-08-31:
-- only generated types mention them). Enabling RLS with no policy = deny-all
-- through PostgREST while service_role/SQL keep working. Drop candidates, but
-- that's data deletion — Alex's call, not a migration's.
alter table _fp_land_pre_20260829 enable row level security;
alter table _fp_land_post_20260829 enable row level security;
alter table _fp_land_subjects_20260829 enable row level security;
alter table dup_note_cleanup_20260814 enable row level security;
alter table email_leads_archive enable row level security;
