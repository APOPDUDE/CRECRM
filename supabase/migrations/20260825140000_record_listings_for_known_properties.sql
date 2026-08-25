-- Record a market listing on a property we already own, without minting a new one.
--
-- Alex, 2026-08-25: "every property we scrape, if we can match it to a property in the
-- database, it should be recorded."
--
-- The sweep returns far more than industrial and land -- a Hillsborough run is 195 Office,
-- 167 Commercial, 75 Medical, 30 Strip Center and so on. We deliberately do not create
-- properties for those; the book is an industrial book. But when one of them IS a building we
-- already track, the fact that it just hit the market is worth knowing, and today we throw it
-- away.
--
-- This function is the narrow door for that: it attaches a market_listing to an EXISTING
-- property and never inserts one. Keeping it separate from import_scraped_listings is
-- deliberate -- that function is the only path allowed to create properties, and this one must
-- never be able to.
--
-- Matching, in order:
--   1. exact source_key  (same LoopNet listing id we already recorded)
--   2. exact address + city + state, normalised for case and whitespace
--
-- It does NOT re-key the matched property. That matters: claim-by-address is how a listing gets
-- attached to a neighbouring parcel (see reference-listing-url-from-source-key, and the
-- 2026-08-18 guard in import_scraped_listings that refuses to re-key an existing listing).
-- Attaching a listing is reversible; re-keying a property is not.

create or replace function public.record_market_listings_for_known(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r jsonb;
  v_id uuid;
  v_key text;
  v_ml_source text;
  v_ml_id text;
  v_ml_type deal_type;
  v_rate numeric;
  v_price numeric;
  v_matched int := 0;
  v_skipped int := 0;
  v_ids uuid[] := '{}';
begin
  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as t(value) loop
    v_key := coalesce(nullif(r->>'source_listing_id',''),
                      case when nullif(r->>'loopnet_id','') is not null
                           then 'loopnet:' || (r->>'loopnet_id') end);

    v_id := null;
    if v_key is not null then
      select id into v_id from properties where source_key = v_key limit 1;
    end if;

    if v_id is null and nullif(r->>'address','') is not null
       and lower(trim(r->>'address')) <> 'address unavailable' then
      select id into v_id from properties
       where lower(trim(address)) = lower(trim(r->>'address'))
         and lower(coalesce(trim(city),''))  = lower(coalesce(trim(r->>'city'),''))
         and lower(coalesce(trim(state),'')) = lower(coalesce(trim(r->>'state'),''))
       order by created_at asc
       limit 1;
    end if;

    -- Not a building we track. Nothing to record; do NOT create it.
    if v_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_rate  := nullif(r->>'asking_rate_psf','')::numeric;
    v_price := nullif(r->>'asking_price','')::numeric;
    v_ml_id := coalesce(nullif(r->>'market_listing_id',''), nullif(r->>'loopnet_id',''), v_key);
    v_ml_source := coalesce(nullif(r->>'market_source',''), 'loopnet');
    v_ml_type := coalesce((nullif(r->>'listing_deal_type',''))::deal_type,
                          (case when v_rate is not null then 'lease' else 'sale' end)::deal_type);
    if v_ml_type = 'both' then v_ml_type := 'lease'; end if;
    if v_ml_id is null then v_skipped := v_skipped + 1; continue; end if;

    insert into market_listings (
      property_id, source, source_listing_id, listing_type, status,
      first_seen_at, last_seen_at, off_market_at,
      asking_rate_psf, asking_price, cap_rate_pct, sqft,
      broker_name, broker_company, url)
    values (
      v_id, v_ml_source, v_ml_id, v_ml_type, 'on_market',
      now(), now(), null,
      v_rate, case when v_rate is null then v_price end,
      nullif(r->>'cap_rate_pct','')::numeric,
      coalesce(nullif(r->>'gross_sf','')::int, nullif(r->>'building_sf','')::int),
      nullif(r->>'broker_name',''), nullif(r->>'broker_company',''),
      coalesce(nullif(r->>'listing_url',''), nullif(r->>'source_url','')))
    on conflict (source, source_listing_id) do update set
      property_id     = excluded.property_id,
      listing_type    = excluded.listing_type,
      status          = 'on_market',
      last_seen_at    = now(),
      off_market_at   = null,
      asking_rate_psf = coalesce(excluded.asking_rate_psf, market_listings.asking_rate_psf),
      asking_price    = coalesce(excluded.asking_price,    market_listings.asking_price),
      cap_rate_pct    = coalesce(excluded.cap_rate_pct,    market_listings.cap_rate_pct),
      sqft            = coalesce(excluded.sqft,            market_listings.sqft),
      broker_name     = coalesce(excluded.broker_name,     market_listings.broker_name),
      broker_company  = coalesce(excluded.broker_company,  market_listings.broker_company),
      url             = coalesce(excluded.url,             market_listings.url),
      updated_at      = now();

    v_matched := v_matched + 1;
    v_ids := v_ids || v_id;
  end loop;

  return jsonb_build_object('matched', v_matched, 'skipped', v_skipped,
                            'property_ids', to_jsonb(v_ids));
end $function$;

comment on function public.record_market_listings_for_known(jsonb) is
  'Attaches market listings to properties that already exist, matching on source_key then exact '
  'address+city+state. Never inserts a property and never re-keys one -- import_scraped_listings '
  'remains the only path that creates. Used for scraped rows outside the industrial/land book '
  '(office, retail, medical) that nonetheless sit on a building we track.';

grant execute on function public.record_market_listings_for_known(jsonb) to authenticated, service_role;
