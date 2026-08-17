-- Rebuild import_owner_addresses for the companies model.
--
-- The owner-era version was dropped with the owners table (20260815225342). The NAME is still on
-- the bulk-load edge function's allowlist, so rebuilding it here reuses that pipe with no
-- edge-function redeploy -- and keeps the import logic in Postgres, where the project rule says
-- business rules live.
--
-- Purpose: backfill companies.mailing_city/_state/_zip from the FDOR NAL roll, which carries them
-- structured while the CRM only ever stored a street line. Postcard campaigns need the full
-- address; before this, 0 of 13,793 companies had a city.
--
-- FILL-NULL ONLY, by design. coalesce() means an existing value is never overwritten -- FDOR is
-- more complete than what the CRM holds (~30% of stored mailing lines are truncated at a C/O line
-- or hold a bare city), but replacing existing data is a separate decision, not this one.
-- Idempotent: replaying a chunk after it lands changes nothing.
create or replace function public.import_owner_addresses(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated int;
  v_seen    int;
begin
  select count(*) into v_seen from jsonb_array_elements(coalesce(p, '[]'::jsonb));

  with rows as (
    select (x->>'company_id')::uuid            as cid,
           nullif(btrim(x->>'address'), '')    as addr,
           nullif(btrim(x->>'city'), '')       as city,
           nullif(btrim(x->>'state'), '')      as st,
           nullif(btrim(x->>'zip'), '')        as zip
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x
    where nullif(btrim(x->>'company_id'), '') is not null
  ),
  upd as (
    update companies c
    set mailing_address = coalesce(c.mailing_address, r.addr),
        mailing_city    = coalesce(c.mailing_city,    r.city),
        mailing_state   = coalesce(c.mailing_state,   r.st),
        mailing_zip     = coalesce(c.mailing_zip,     r.zip)
    from rows r
    where c.id = r.cid
      and (c.mailing_address is null or c.mailing_city is null
           or c.mailing_state is null or c.mailing_zip is null)
    returning 1
  )
  select count(*) into v_updated from upd;

  return jsonb_build_object('ok', true, 'seen', v_seen, 'updated', v_updated);
end $function$;

comment on function public.import_owner_addresses(jsonb) is
  'Fill-null backfill of companies.mailing_address/city/state/zip from the FDOR roll, via the bulk-load edge pipe. Never overwrites an existing value.';

-- Applied 2026-08-17. Loaded 10,719 companies in 8 chunks through /functions/v1/bulk-load
-- (seen 10,719 / updated 10,719, zero failures). Fully-mailable companies went 0 -> 10,719.
-- Source join: CRM parcel_number -> FDOR NAL parcel_id via the vetted crm_cov match (13,288) plus
-- the documented per-county key rules for the remainder (726) = 14,013 of 14,833 parcels (94%).
