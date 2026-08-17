-- Email channel, follow-on fixes found by running the thing against real data on 2026-08-17.
-- Everything here was applied to the live database the same day; this file exists so the repo
-- matches it (foundation rule 3). Parts 1-4 are 20260817000100 through 000400.
--
-- Four fixes, each traceable to a specific real record:
--
-- 1. THE QUOTE-STRIPPER WAS TRUNCATING REAL REPLIES (twice over).
--    Bernadette Cooney replied "I will keep your info on file. Thanks Bernadette" and it stored as
--    "I will keep your info". Two independent bugs:
--      a) the cut anchored on (^|\n), but the de-HTML step turns <div>/<br> into SPACES, so a Gmail
--         reply arrives as ONE long line and the anchor never matched -- the whole quoted chain was
--         being kept.
--      b) with the 'i' flag, 'On\s.{0,160}?wrote:' matched the LOWERCASE "on" inside "on file" and
--         cut the sentence in half.
--    Both matter beyond cosmetics: the stored body is what Alex reads on the contact, AND the
--    25-character content guard is measured against it -- an un-cut chain makes every thin reply
--    look substantial, while an over-eager cut downgrades a real one.
--    Regression-checked over all 162 real Smartlead bodies already in the book: 0 retain a quoted
--    chain, 1 cuts to empty, 23 fall under 25 chars (correctly -- those are the genuinely thin ones).
--
-- 2. 'thank you for your email' was too broad an autoresponder pattern. Bernadette's real words
--    were "Thanks for reaching out. We are not looking to sell the property." -- a human reply that
--    an over-broad pattern would have demoted to address-only.
--
-- 3. A REPLY FROM AN UNKNOWN ADDRESS NOW MINTS THE CONTACT. This was the gap Alex actually hit:
--    Bernadette replied twice on 2026-08-17 and nothing appeared in the CRM, because the write-back
--    only UPDATED contacts that already existed. A real human answering an email is exactly the
--    evidence the doctrine asks for. Not minted for a bounce -- nobody was there.
--    The name is taken from the address local-part when Smartlead's name does not appear in the
--    address, because Smartlead's enrichment stamps ONE name across every address at a domain:
--    bernadette@lakeshoreathleticservices.com arrives labelled "Thomas Cooney".
--
-- 4. THE CRM WINS ON PROPERTY FACTS. GHL's "Building SF" custom field reads 26552 and "Land Acres"
--    2.2 on EVERY "2810 buyers" row, across different properties in different cities -- a stale
--    constant. 20260817000300 had GHL winning the coalesce, so every personalised email would have
--    quoted the same wrong square footage to everyone. gross_sf / land_acres / property_type are
--    county-sourced and trigger-locked, so the CRM is the authority and GHL only fills the gaps.
--    After the fix the live audience returns 55 DISTINCT building_sf values across 71 leads.
--
-- Also recorded here, not a schema change: Alex's 2026-08-17 calls, already folded into
-- 20260817000300 -- 'wrong person' is no longer an email stop-tag (it means "wrong person for the
-- PHONE NUMBER we dialled"), and allow_business_domains now defaults TRUE ("use all the emails").

begin;

-- ---------------------------------------------------------------------------
-- 1 + 2. The reply-content helpers.
-- ---------------------------------------------------------------------------
create or replace function email_reply_significant_text(p_body text)
returns text language sql immutable as $$
  with stripped as (
    select regexp_replace(
             regexp_replace(coalesce(p_body, ''), '<[^>]+>', ' ', 'g'),
             '&(nbsp|amp|lt|gt|quot|#39);', ' ', 'g') as t
  ), cut as (
    select split_part(
             regexp_replace(t,
               '(\mOn\s.{0,160}?wrote:|-{2,}\s*[Oo]riginal [Mm]essage\s*-{2,}|_{10,}'
               '|\mFrom:\s|\mSent from my\M|\mGet Outlook for|\mBegin forwarded message)',
               E'\x01'),
             E'\x01', 1) as t
    from stripped
  )
  select btrim(regexp_replace(t, '\s+', ' ', 'g')) from cut
$$;

comment on function email_reply_significant_text is
  'What the human actually typed: de-HTML, cut at the first quoted-chain / forwarded-header marker, '
  'collapse whitespace. NOT anchored to a line start (de-HTML collapses a Gmail reply onto one '
  'line) and deliberately CASE-SENSITIVE (a case-insensitive "On...wrote:" matches the word "on" '
  'mid-sentence and truncates real replies).';

create or replace function email_reply_is_autoreply(p_text text)
returns boolean language sql immutable as $$
  select coalesce(p_text, '') ~* (
    'out of (the )?office|automatic reply|auto[- ]?reply|autoresponder|currently (away|out)|'
    'on (leave|vacation|holiday|pto)|away from (my )?(desk|email)|will (be )?back on|'
    'no longer (with|at|employed)|has left the (company|firm)|undeliverable|'
    'delivery (has )?failed|mail delivery|address not found'
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. Property-fact merge, CRM-first.
-- ---------------------------------------------------------------------------
create or replace function email_audience_property_merge(
  p_prop_id uuid,
  p_ghl_type text, p_ghl_addr text, p_ghl_city text, p_ghl_county text,
  p_ghl_state text, p_ghl_zip text, p_ghl_sf text, p_ghl_acres text)
returns table (
  property_type text, property_address text, city text, county text,
  state text, zip text, building_sf text, land_acres text)
language sql stable as $$
  select
    coalesce(replace(pr.property_type::text, '_', ' '), p_ghl_type),
    coalesce(pr.address,          p_ghl_addr),
    coalesce(pr.city,             p_ghl_city),
    coalesce(pr.county,           p_ghl_county),
    coalesce(pr.state,            p_ghl_state),
    coalesce(pr.zip,              p_ghl_zip),
    coalesce(pr.gross_sf::text,   p_ghl_sf),
    coalesce(pr.land_acres::text, p_ghl_acres)
  from properties pr
  where pr.id = p_prop_id
  union all
  select p_ghl_type, p_ghl_addr, p_ghl_city, p_ghl_county,
         p_ghl_state, p_ghl_zip, p_ghl_sf, p_ghl_acres
  where p_prop_id is null or not exists (select 1 from properties where id = p_prop_id)
  limit 1
$$;

comment on function email_audience_property_merge is
  'Merge the property facts for a campaign lead. The CRM WINS -- gross_sf/land_acres/property_type '
  'are county-sourced and trigger-locked, while the GHL custom fields are stale (Building SF reads '
  '26552 on every "2810 buyers" row). GHL only fills what the CRM lacks.';

commit;

-- NOTE: apply_smartlead_event (fix 3, the minting branch) and email_audience_build (fix 4, calling
-- the helper above) are defined in full in 20260817000400 and 20260817000300 respectively -- both
-- of those FILES already carry these changes, so re-running them reproduces the live state. This
-- file only holds the standalone helpers, so that a fresh replay of the migration directory in
-- order (000100 → 000200 → 000300 → 000400 → 000500) lands exactly where the database is now.
