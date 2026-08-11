-- County records are the source of truth for parcel identity (Alex 2026-08-11, the David
-- Lasser case). Two identity gaps let a known property look missing:
--
--  1. Hillsborough issues TWO ids per parcel -- a 10-digit FOLIO and a letter-prefixed PIN
--     (U-03-30-19-942-000000-00030.0). We store the PIN on 4,870 of 4,976 Hillsborough rows;
--     GHL's Parcel ID field carries the FOLIO. ghl_verify_owner compared them with plain
--     equality, so a folio NEVER matched and every folio-carrying contact fell through to the
--     address fallback. enrich-appraiser already knew about the dual id; the RPC did not.
--  2. The address fallback is unreliable because we keep LoopNet's marketing range
--     ("4428-4450 Eagle Falls Pl") while the county -- and therefore every caller, list and
--     skip trace -- uses the situs address ("4456 Eagle Falls Pl"). enrich-appraiser fetched
--     the situs address and then threw it away whenever ours was non-blank. Measured against
--     the county layer, 8% of a 150-row Hillsborough sample disagreed with the county.
--
-- So: store both county identifiers alongside what the listing sites gave us, and resolve
-- against all of them. Nothing here overwrites address or appraiser_data -- a bulk appraiser
-- run is writing those concurrently and owns them.

alter table properties add column if not exists folio text;
alter table properties add column if not exists site_address text;

comment on column properties.folio is
  'County numeric parcel id (Hillsborough FOLIO), digits only. Distinct from parcel_number, '
  'which holds whatever id the source gave us -- for Hillsborough that is usually the PIN. '
  'Both are county-issued and both must resolve to the same property.';
comment on column properties.site_address is
  'The county appraiser situs address -- authoritative. properties.address may hold a '
  'listing-site marketing address (often a range like "4428-4450 Eagle Falls Pl"); prefer '
  'site_address for display and always search both.';

-- Parcel ids arrive punctuated inconsistently (and sometimes as a comma-separated list, where
-- the first entry is the primary parcel). Compare on digits alone.
create or replace function normalize_parcel(p text)
returns text language sql immutable as $$
  select nullif(regexp_replace(split_part(coalesce(p, ''), ',', 1), '[^0-9]', '', 'g'), '');
$$;

comment on function normalize_parcel(text) is
  'Digits of the first parcel id in p. Lets a Hillsborough FOLIO match a stored FOLIO, and '
  'absorbs punctuation drift between counties and vendors.';

create index if not exists properties_folio_idx on properties (folio) where folio is not null;
create index if not exists properties_parcel_digits_idx on properties (normalize_parcel(parcel_number));
create index if not exists properties_site_address_idx on properties (normalize_street(site_address));

-- One resolver, used by ghl_verify_owner and anything else that has to turn a caller's
-- "parcel + address" into our row. Ordered most trustworthy first: a parcel id is a county
-- key, an address is a string someone typed.
create or replace function find_property(
  p_parcel text default null,
  p_address text default null,
  p_city text default null
) returns uuid
language sql stable as $$
  with tries as (
    -- 1. the id exactly as stored
    select id, 1 as rank from properties
    where p_parcel is not null and parcel_number = btrim(p_parcel)
    union all
    -- 2. against the county's numeric id
    select id, 2 from properties
    where normalize_parcel(p_parcel) is not null and folio = normalize_parcel(p_parcel)
    union all
    -- 3. same id, punctuation ignored (also catches folio-in-parcel_number rows)
    select id, 3 from properties
    where normalize_parcel(p_parcel) is not null
      and normalize_parcel(parcel_number) = normalize_parcel(p_parcel)
    -- 4/5. county situs address, then whatever address we were given by the source
    union all
    select id, 4 from properties
    where normalize_street(p_address) is not null
      and normalize_street(site_address) = normalize_street(p_address)
      and (p_city is null or city is null or upper(btrim(city)) = upper(btrim(p_city)))
    union all
    select id, 5 from properties
    where normalize_street(p_address) is not null
      and normalize_street(address) = normalize_street(p_address)
      and (p_city is null or city is null or upper(btrim(city)) = upper(btrim(p_city)))
  )
  select id from tries order by rank limit 1;
$$;

comment on function find_property(text, text, text) is
  'Resolve a caller-supplied parcel id and/or address to a property. Parcel beats address; '
  'county situs address beats the source address. Returns null when nothing matches.';
