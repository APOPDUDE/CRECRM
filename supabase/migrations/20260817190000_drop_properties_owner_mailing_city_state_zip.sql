-- Reverses 20260817180000. Alex 2026-08-17: "I don't like having mailing address on the property
-- directly cause that changes."
--
-- He is right, and it is a normalization argument: a mailing address is a fact about the OWNER, not
-- about the parcel. Storing it per-parcel duplicated one owner's address across every property they
-- hold and would drift the moment any one of them was updated. It now lives once, on the owner:
-- companies.mailing_address / mailing_city / mailing_state / mailing_zip.
--
-- Coverage after moving it: 20,510 mailable owners, reaching 28,381 of 31,978 properties (89%) --
-- BETTER than the 27,974 the property-level columns achieved, because every property that has an
-- owner_name now has an owner entity (10,113 minted from the county roll on 2026-08-17).
--
-- properties.owner_mailing_address is KEPT: it predates this work, it is the county's raw per-parcel
-- record (provenance), and the owner-occupier rule compares it against the property's own address --
-- a per-parcel comparison that cannot move to the owner. Do not mail from it; mail from companies.
alter table properties drop column if exists owner_mailing_city;
alter table properties drop column if exists owner_mailing_state;
alter table properties drop column if exists owner_mailing_zip;

-- Keep the importer's property branch OUT now that those columns are gone, but leave the company
-- branch intact so the pipe still serves owner mailing backfills.
create or replace function public.import_owner_addresses(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_co_updated int := 0;
  v_seen       int;
begin
  select count(*) into v_seen from jsonb_array_elements(coalesce(p, '[]'::jsonb));

  with src as (
    select nullif(btrim(x->>'company_id'), '') as cid_t,
           nullif(btrim(x->>'address'), '')    as addr,
           nullif(btrim(x->>'city'), '')       as city,
           nullif(btrim(x->>'state'), '')      as st,
           nullif(btrim(x->>'zip'), '')        as zip
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x
  ),
  upd_co as (
    update companies c
    set mailing_address = coalesce(c.mailing_address, s.addr),
        mailing_city    = coalesce(c.mailing_city,    s.city),
        mailing_state   = coalesce(c.mailing_state,   s.st),
        mailing_zip     = coalesce(c.mailing_zip,     s.zip)
    from src s
    where s.cid_t is not null and c.id = s.cid_t::uuid
      and (c.mailing_address is null or c.mailing_city is null
           or c.mailing_state is null or c.mailing_zip is null)
    returning 1
  )
  select count(*) into v_co_updated from upd_co;

  return jsonb_build_object('ok', true, 'seen', v_seen, 'companies_updated', v_co_updated);
end $function$;

-- Applied 2026-08-17, after minting 10,113 owner entities from the county roll so that every
-- property with an owner_name has an owner to carry the address (companies 13,793 -> 23,906).
