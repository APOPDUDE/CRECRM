-- Finding a property you already own should not require its parcel ID (Alex 2026-08-12).
--
-- "Add property" on a client asked for a parcel ID + county first, and searched the book only as
-- an afterthought -- through `address ilike '%typed%'` against ONE column. With 17,522 properties
-- that is backwards: the answer is almost always already in the book. Three ways the old query
-- failed to find a property we definitely have:
--   * it never looked at `site_address`. The county's address is what the app displays, exports
--     and skip-traces on, and it DIFFERS from the stored one on 480 rows -- the same defect that
--     hid 4456 Eagle Falls Pl (see 20260811000004). You would type what the app just showed you
--     and get nothing.
--   * one substring against `address` alone left city/county/zip unsearchable, so
--     "sydney rd plant city" missed a property whose city lives in its own column.
--   * "4456 Eagle Falls Place" and "4456 Eagle Falls Pl" were different strings.
--
-- This mirrors `search_contacts` (20260812000001): search runs in Postgres over the whole table,
-- and every word must appear SOMEWHERE on the property rather than all in one column.
--
-- normalize_address_text() is the SQL twin of `normalizeAddressText()` in src/lib/address-search.ts
-- and the fold lists MUST stay in step -- the War Room filters its loaded page with the TS one,
-- this searches all 17,522 rows with the SQL one, and a user should not be able to tell which box
-- is answering. (The MATCHER is deliberately stricter here; see the whole-word note below.)
--
-- PERFORMANCE, learned the hard way -- three measured rounds:
--   36,000ms  normalizing every row at query time, ~70 chained regexp_replace passes per row
--    1,080ms  precomputed generated column, but a correlated per-row subquery per token
--       84ms  + pg_trgm GIN index, anchored on the query's longest (most selective) word
-- Both derived values are STORED GENERATED columns, computed on write.
--
-- ⚠️ A generated column is computed on write and NEVER recomputed. If the abbreviation list below
-- changes, existing rows keep their old normalization until forced to rewrite:
--     update properties set address = address;   -- cheapest full re-derive
-- Doing neither leaves search silently disagreeing with the frontend for every old row.

create or replace function normalize_address_text(p_text text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    string_agg(
      case tok
        -- street types
        when 'road' then 'rd'        when 'street' then 'st'      when 'avenue' then 'ave'
        when 'av' then 'ave'         when 'drive' then 'dr'       when 'boulevard' then 'blvd'
        when 'lane' then 'ln'        when 'court' then 'ct'       when 'circle' then 'cir'
        when 'highway' then 'hwy'    when 'parkway' then 'pkwy'   when 'pky' then 'pkwy'
        when 'pkway' then 'pkwy'     when 'place' then 'pl'       when 'terrace' then 'ter'
        when 'trail' then 'trl'      when 'square' then 'sq'      when 'expressway' then 'expy'
        when 'freeway' then 'fwy'    when 'turnpike' then 'tpke'  when 'route' then 'rt'
        when 'suite' then 'ste'      when 'apartment' then 'apt'  when 'building' then 'bldg'
        -- name prefixes that are conventionally abbreviated
        when 'saint' then 'st'       when 'fort' then 'ft'        when 'mount' then 'mt'
        -- directionals
        when 'north' then 'n'        when 'south' then 's'        when 'east' then 'e'
        when 'west' then 'w'         when 'northeast' then 'ne'   when 'northwest' then 'nw'
        when 'southeast' then 'se'   when 'southwest' then 'sw'
        -- state names -> USPS codes (the book is ~99% FL but carries a handful of others)
        when 'alabama' then 'al'     when 'alaska' then 'ak'      when 'arizona' then 'az'
        when 'arkansas' then 'ar'    when 'california' then 'ca'  when 'colorado' then 'co'
        when 'connecticut' then 'ct' when 'delaware' then 'de'    when 'florida' then 'fl'
        when 'georgia' then 'ga'     when 'hawaii' then 'hi'      when 'idaho' then 'id'
        when 'illinois' then 'il'    when 'indiana' then 'in'     when 'iowa' then 'ia'
        when 'kansas' then 'ks'      when 'kentucky' then 'ky'    when 'louisiana' then 'la'
        when 'maine' then 'me'       when 'maryland' then 'md'    when 'massachusetts' then 'ma'
        when 'michigan' then 'mi'    when 'minnesota' then 'mn'   when 'mississippi' then 'ms'
        when 'missouri' then 'mo'    when 'montana' then 'mt'     when 'nebraska' then 'ne'
        when 'nevada' then 'nv'      when 'ohio' then 'oh'        when 'oklahoma' then 'ok'
        when 'oregon' then 'or'      when 'pennsylvania' then 'pa' when 'tennessee' then 'tn'
        when 'texas' then 'tx'       when 'utah' then 'ut'        when 'vermont' then 'vt'
        when 'virginia' then 'va'    when 'washington' then 'wa'  when 'wisconsin' then 'wi'
        when 'wyoming' then 'wy'
        else tok
      end,
      ' ' order by ord
    ),
    ''
  )
  from unnest(
    string_to_array(
      btrim(regexp_replace(
        regexp_replace(lower(coalesce(p_text, '')), '(\d{5})-\d{4}', '\1', 'g'),
        '[^a-z0-9]+', ' ', 'g')),
      ' ')
  ) with ordinality as t(tok, ord)
  where tok <> '';
$function$;

comment on function normalize_address_text(text) is
  'Canonical address text: lowercase, ZIP+4 reduced, punctuation dropped, street types / '
  'directionals / state names folded to their abbreviations. SQL twin of normalizeAddressText() '
  'in src/lib/address-search.ts -- keep the two fold lists in step.';

-- NOTE: concat_ws() is STABLE, not IMMUTABLE (it calls type output functions), so a generated
-- column cannot use it. Plain text || is immutable.
alter table properties
  add column if not exists search_text text
    generated always as (
      normalize_address_text(
        coalesce(address, '') || ' ' || coalesce(site_address, '') || ' ' ||
        coalesce(city, '') || ' ' || coalesce(state, '') || ' ' || coalesce(zip, '') || ' ' ||
        coalesce(county, '') || ' ' || coalesce(parcel_number, '') || ' ' || coalesce(folio, '')
      )
    ) stored;

-- parcel_number carries letters (Hillsborough "U-31-28-19-ZZZ-..."), so a digits-only key cannot
-- match it. Alphanumeric per id, separated by '|' so a match can never span the parcel/folio join.
alter table properties
  add column if not exists parcel_key text
    generated always as (
      lower(regexp_replace(coalesce(parcel_number, ''), '[^a-zA-Z0-9]', '', 'g'))
      || '|' ||
      regexp_replace(coalesce(folio, ''), '[^0-9]', '', 'g')
    ) stored;

comment on column properties.search_text is
  'Generated: every identifying field folded to canonical address text, for search_properties(). '
  'Computed on write and never recomputed -- see 20260812000003 before changing the fold rules.';

create extension if not exists pg_trgm;

-- the GIN trigram index is what makes the anchor LIKE '%word%' cheap
create index if not exists properties_search_text_trgm
  on properties using gin (search_text gin_trgm_ops);
create index if not exists properties_parcel_key_idx on properties (parcel_key);

create or replace function search_properties(
  p_query text,
  p_limit int default 12
)
returns table (
  id uuid,
  address text,
  source_address text,
  city text,
  state text,
  zip text,
  county text,
  parcel_number text,
  folio text
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with q as (
    select
      normalize_address_text(p_query) as text_q,
      lower(regexp_replace(coalesce(p_query, ''), '[^a-zA-Z0-9]', '', 'g')) as alnum,
      (select '%' || tok || '%'
         from unnest(string_to_array(normalize_address_text(p_query), ' ')) tok
        where btrim(tok) <> ''
        order by length(tok) desc, tok
        limit 1) as anchor
  ),
  toks as (
    select array_agg(tok order by ord) as list, count(*) as n
    from unnest(string_to_array((select text_q from q), ' ')) with ordinality as t(tok, ord)
    where btrim(tok) <> ''
  )
  select p.id,
         -- the county's address is what the app shows everywhere else, so it is what a search
         -- has to answer to; the scraped original stays reachable as source_address
         coalesce(p.site_address, p.address) as address,
         p.address as source_address,
         p.city, p.state, p.zip, p.county, p.parcel_number, p.folio
  from properties p, q, toks
  where q.text_q <> ''
    -- scrape placeholders are not addresses and must never be offered as a pick
    and p.address not ilike '%unavailable%'
    and p.address not ilike 'Portfolio of %'
    and (
      -- a parcel id / folio, however it was punctuated
      (length(q.alnum) >= 6 and p.parcel_key like '%' || q.alnum || '%')
      or (
        -- narrow with the most selective word first so the trigram index can be used...
        p.search_text like q.anchor
        -- ...then require EVERY word as a WHOLE word. Substring matching (what the frontend
        -- does over its already-narrowed page) is far too loose across 17,522 rows: tokens like
        -- "0" or "19" sit inside almost every row's text, so a query matching nothing real still
        -- came back full of unrelated properties -- the worst possible answer in a dialog whose
        -- job is telling you whether we already have the building.
        and not exists (
          select 1
          from unnest(toks.list) with ordinality as u(tok, ord)
          where case
                  -- the word still being typed only has to be a prefix
                  when u.ord = toks.n then ' ' || p.search_text not like '% ' || u.tok || '%'
                  else ' ' || p.search_text || ' ' not like '% ' || u.tok || ' %'
                end
        )
      )
    )
  order by
    case
      when p.search_text = q.text_q then 0                     -- exact
      when p.search_text like q.text_q || '%' then 1           -- starts with what was typed
      when position(q.text_q in p.search_text) > 0 then 2
      else 3                                                   -- matched on city/county/parcel
    end,
    coalesce(p.site_address, p.address),
    p.id
  limit greatest(coalesce(p_limit, 12), 1);
$function$;

comment on function search_properties(text, int) is
  'Typeahead over the whole property book by address (stored OR county site_address), city, '
  'state, zip, county, parcel number or folio. Every word must appear as a WHOLE word somewhere '
  'on the property (the last one may be a prefix, so it matches while you type); an alphanumeric '
  'run of 6+ chars also matches a parcel number or folio whatever its punctuation. Runs as the '
  'caller, so properties RLS applies.';

revoke execute on function search_properties(text, int) from public, anon;
grant execute on function search_properties(text, int) to authenticated;
