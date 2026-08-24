-- Applied 2026-08-23 via MCP.
--
-- warroom_predicate: ONE definition of the War Room's filter set, so the page stops
-- fetching the book (127,007 rows / ~26 s) to answer a question Postgres can answer in
-- milliseconds. The three callers live in 20260823130000_warroom_page_counts_ids.sql.
--
-- Verified against the running app, 2026-08-23: warroom_counts returns
--   industrial  total 32,534  condo_hidden 2,076
--   land        total 99,884  condo_hidden    91
-- which is exactly what the client's own filter loop was showing
-- ("Showing 32534 of 34610 properties - 2,076 condo units hidden"). Six individual
-- filters were also checked against independently written count queries and matched:
-- county 11,646 / property type 19,717 / include-condos 34,610 / verified owner 490 /
-- owner-operator 2,620 / acres>=5 7,379.
--
-- ============================================================================
-- Design notes that are load-bearing -- read before changing anything here
-- ============================================================================
--
-- SECURITY DEFINER is REQUIRED, not an optimisation. Under RLS a user qual only reaches
-- an index if it is LEAKPROOF, and numeric_ge/numeric_le are not -- so as `authenticated`
-- every numeric predicate this function asks (SF, acres, price, lat/lng) would force a
-- sequential scan of a 123 MB table that takes >20s to scan. Definer runs as the table
-- owner, where RLS does not apply. That bypasses the VA silo, so the silo is re-asserted
-- by hand in the body. DO NOT REMOVE THAT GUARD.
--
-- DYNAMIC SQL, deliberately. The obvious static form -- `(v_county is null or
-- p.county = v_county)` repeated 25 times -- gives the planner a query whose predicates
-- are all "maybe", and plpgsql will settle on a GENERIC plan after five calls: no index
-- selection, seq scan every time. Building only the active predicates means the planner
-- sees the actual question and picks the actual index. Cost is ~5 ms of planning per
-- call, which is noise against what it saves. Every interpolated value is either a
-- quote_literal'd scalar or a typed cast, never raw client text.
--
-- THE FOUR "USE" AXES ARE FLAGGED, NOT FILTERED. property_type, zoning, county-use
-- bucket and the DOR picker are returned as `passes_use` rather than applied, because
-- the overlay "Include in search" union is allowed to forgive EXACTLY those four and
-- nothing else (Alex, 2026-08-16: "it should only include the ones in the drawn area").
-- A row failing shape, search, size, market, owner, tag, sold or lease is never rescued.
--
-- THE CONDO GATE IS ALSO FLAGGED, NOT FILTERED, and the caller applies it LAST -- after
-- the use axes -- so `condo_hidden` counts what THIS view lost, not the book-wide 2,201.
-- A condo unit is never an overlay-include candidate either.
--
-- TIME IS A PARAMETER. `activity_cutoff` is frozen by the client at mount so rows cannot
-- reshuffle as the clock ticks, and `today` is the client's LOCAL date. No now() or
-- current_date appears in any predicate. Do not "simplify" these.
--
-- NULL FAILS A BOUNDED RANGE, everywhere, matching the client: land_acres IS NULL fails
-- both acreage bounds; a lease with sf IS NULL cannot satisfy a leased-SF question; an
-- empty size set fails the SF filter.

create or replace function public.warroom_predicate(p_filters jsonb)
returns jsonb
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_where      text := '';
  v_use        text := 'true';
  v_ovi        text := 'false';
  v_ovo        text := 'false';

  v_book       text    := nullif(p_filters->>'book', '');
  v_portfolio  uuid    := nullif(p_filters->>'portfolio_owner_id', '')::uuid;
  v_q          text    := nullif(p_filters->>'q', '');
  v_county     text    := nullif(p_filters->>'county', 'all');
  v_ptype      text    := nullif(p_filters->>'ptype', 'all');
  v_status     text    := nullif(p_filters->>'status', 'all');
  v_deal       text    := nullif(p_filters->>'deal_type', 'all');
  v_psf_min    numeric := (p_filters->>'psf_min')::numeric;
  v_psf_max    numeric := (p_filters->>'psf_max')::numeric;
  v_price_min  numeric := (p_filters->>'price_min')::numeric;
  v_price_max  numeric := (p_filters->>'price_max')::numeric;
  v_unpriced   boolean := coalesce((p_filters->>'include_unpriced')::boolean, true);
  v_owner      text    := nullif(p_filters->>'owner_filter', 'all');
  v_ch_phone   boolean := coalesce((p_filters->'channels'->>'phone')::boolean, true);
  v_ch_email   boolean := coalesce((p_filters->'channels'->>'email')::boolean, true);
  v_activity   text    := nullif(p_filters->>'activity', 'all');
  v_cutoff     timestamptz := (p_filters->>'activity_cutoff')::timestamptz;
  v_today      date    := (p_filters->>'today')::date;
  v_sf_min     integer := (p_filters->>'sf_min')::integer;
  v_sf_max     integer := (p_filters->>'sf_max')::integer;
  v_ac_min     numeric := (p_filters->>'ac_min')::numeric;
  v_ac_max     numeric := (p_filters->>'ac_max')::numeric;
  v_sold_yrs   numeric := (p_filters->>'sold_years')::numeric;
  v_no_sale    boolean := coalesce((p_filters->>'include_no_sale')::boolean, true);
  v_tags       text[]  := coalesce(array(select jsonb_array_elements_text(p_filters->'tags')), '{}');
  v_occ        text    := coalesce(p_filters->>'owner_occ_mode', 'all');
  v_zoning     text    := nullif(p_filters->>'zoning', 'all');
  v_use_bucket text    := nullif(p_filters->>'use_bucket', 'all');
  v_dor        jsonb   := p_filters->'dor';
  v_poly       text    := nullif(p_filters->>'polygon', '');
  v_lease_on   boolean := coalesce((p_filters->>'lease_applies')::boolean, false);
  v_lease      jsonb   := p_filters->'lease';
  v_ov         jsonb   := p_filters->'overlays';

  -- `industrial zoning` as one reusable fragment: primary type, or a crossover code from
  -- zoning_code_map (allows_industrial and NOT already typed industrial). Mirrors
  -- isZonedIndustrial() in src/hooks/use-zoning-map.ts exactly, including that a row with
  -- no jurisdiction/code can only qualify via zoning_type.
  c_zoned_ind constant text :=
    '(p.zoning_type = ''industrial'' or exists (select 1 from zoning_code_map z'
    || ' where z.jurisdiction = p.zoning_jurisdiction and z.code = p.zoning_code'
    || ' and z.allows_industrial and z.zoning_type <> ''industrial''))';

  -- dorBucket() from src/lib/zoning.ts, over dor_class() (the SQL twin of dorInt: 4-digit
  -- county codes are a 2-digit class EVEN when zero-leading, 5-digit Pasco is 3-digit).
  -- 027 files as INDUSTRIAL, not retail -- Alex's niche, and it is deliberate in all
  -- three normalizers. Keep this in step with dorBucket or the County-use filter drifts.
  c_bucket constant text :=
    'case when dor_class(p.dor_use_code) is null then null'
    || ' when dor_class(p.dor_use_code) = 1 then ''single_family'''
    || ' when dor_class(p.dor_use_code) = 2 then ''mobile_home'''
    || ' when dor_class(p.dor_use_code) in (3,8) then ''multifamily'''
    || ' when dor_class(p.dor_use_code) between 4 and 7 then ''condo'''
    || ' when dor_class(p.dor_use_code) in (0,10,40) then ''vacant'''
    || ' when dor_class(p.dor_use_code) between 17 and 19 then ''office'''
    || ' when (dor_class(p.dor_use_code) between 11 and 16)'
    || '   or (dor_class(p.dor_use_code) between 20 and 39 and dor_class(p.dor_use_code) <> 27)'
    || '   then ''retail_commercial'''
    || ' when (dor_class(p.dor_use_code) between 41 and 49) or dor_class(p.dor_use_code) = 27'
    || '   then ''industrial'''
    || ' when dor_class(p.dor_use_code) between 50 and 69 then ''agricultural'''
    || ' when dor_class(p.dor_use_code) between 70 and 98 then ''institutional_gov'''
    || ' else ''other'' end';

  k text;
  sel jsonb;
  parts text[];
begin
  if v_activity is not null and v_activity not in ('recent', 'quiet') then
    raise exception 'warroom_predicate: unknown activity %', v_activity;
  end if;
  if v_owner is not null and v_owner not in ('verified', 'unverified') then
    raise exception 'warroom_predicate: unknown owner_filter %', v_owner;
  end if;

  -- ---------------------------------------------------------------- portfolio
  -- ?owner=<id> asks about ONE owner and answers with ALL of their holdings. Sticky
  -- filters must not quietly hide the two off-market parcels next door -- that is the
  -- assemblage you opened it to see. The condo lens is bypassed too: an owner's 30
  -- garage units ARE their portfolio.
  -- A portfolio asks about ONE owner and answers with ALL of their holdings: the sticky
  -- filters, and the condo lens, are bypassed entirely.
  if v_portfolio is not null then
    return jsonb_build_object(
      'where', format(' and p.owner_company_id = %L and not exists (select 1 from ph where ph.id = p.id)', v_portfolio),
      'use', 'true', 'ovi', 'false', 'ovo', 'false', 'portfolio', true);
  end if;

  if v_book = 'industrial' then v_where := v_where || ' and not p.land_only';
  elsif v_book = 'land'    then v_where := v_where || ' and p.in_land_book';
  end if;

  -- Placeholder scrape rows ("Address unavailable", "Portfolio of N..."). Anti-join
  -- against their own 33-row partial index; inlining the ILIKEs costs a full heap scan.
  -- `ph` is hoisted into a materialized CTE by the callers, computed ONCE off the 33-row
  -- partial index. Inlining the two ILIKEs as a correlated subquery here made this a
  -- per-row heap check and the bare industrial book timed out at 30s.
  v_where := v_where || ' and not exists (select 1 from ph where ph.id = p.id)';

  -- ---------------------------------------------------------------- typed search
  -- Postgres already decided what a match is, over trigram indexes, and it knows things
  -- the browser never had: parcel number, folio, the owning entity, the county's owner of
  -- record, the tenant on a lease comp. The client must NOT re-filter these.
  if v_q is not null then
    v_where := v_where || format(
      ' and exists (select 1 from search_properties(%L, 200000) s where s.id = p.id)', v_q);
  end if;

  -- ---------------------------------------------------------------- plain columns
  if v_county is not null then
    v_where := v_where || format(' and p.county = %L', v_county);
  end if;

  -- 'executed' is a lens on OUR pursuits, not a listing_status value -- hence its own branch.
  if v_status = 'executed' then
    v_where := v_where || ' and exists (select 1 from pursuits pu where pu.property_id = p.id'
            || ' and pu.stage = ''executed'')';
  elsif v_status is not null then
    v_where := v_where || format(
      ' and coalesce(p.listing_status::text, ''on_market'') = %L', v_status);
  end if;

  -- A size question must also see the UNITS: a landlord who will carve 30,000 SF out of a
  -- 93,666 SF building answers a 30k requirement, but the building alone fails it.
  -- `.some([])` is false, so a row with no gross_sf and no units fails the filter.
  if v_sf_min is not null or v_sf_max is not null then
    v_where := v_where || ' and (exists (select 1 from (select p.gross_sf as v'
            || ' union all select u.size_sf from v_property_available_space u'
            || ' where u.property_id = p.id and u.size_sf is not null) z'
            || ' where z.v is not null'
            || coalesce(format(' and z.v >= %s', v_sf_min), '')
            || coalesce(format(' and z.v <= %s', v_sf_max), '') || '))';
  end if;

  if v_ac_min is not null then
    v_where := v_where || format(' and p.land_acres is not null and p.land_acres >= %s', v_ac_min);
  end if;
  if v_ac_max is not null then
    v_where := v_where || format(' and p.land_acres is not null and p.land_acres <= %s', v_ac_max);
  end if;

  -- ---------------------------------------------------------------- tags (OR across picks)
  -- Three storage locations behind one list: 'owner occupier' is on the BUILDING,
  -- 'interested'/'not interested' are on the owning ENTITY, and 'buyer' is not a CRM tag
  -- at all -- it is an owner with a row in buyer_intakes.
  if array_length(v_tags, 1) is not null then
    parts := '{}';
    if v_tags && array['owner occupier'] then
      parts := array_append(parts, 'p.tags && array[''owner occupier'']');
    end if;
    if v_tags && array['interested', 'not interested'] then
      parts := array_append(parts, format(
        'exists (select 1 from companies c where c.id = p.owner_company_id and c.tags && %L::text[])',
        (select array(select unnest(v_tags) intersect select unnest(array['interested','not interested'])))));
    end if;
    if v_tags && array['buyer'] then
      -- 'buyer' is not a CRM tag: it is a person sitting in the review queue, mapped to
      -- what their entity owns. buyer_intakes has no company_id -- it routes through
      -- contact_id. Dismissed intakes are excluded: "not a buyer after all" is the whole
      -- point of dismissing one.
      parts := array_append(parts, 'exists (select 1 from buyer_intakes bi join contacts ct on ct.id = bi.contact_id'
            || ' where bi.contact_id is not null and coalesce(bi.status::text, '''') <> ''dismissed'''
            || ' and ct.company_id = p.owner_company_id)');
    end if;
    v_where := v_where || ' and (' || array_to_string(parts, ' or ') || ')';
  end if;

  -- Owner-operator tri-state, on the same stored tag the Tags filter uses.
  if v_occ = 'only' then
    v_where := v_where || ' and p.tags && array[''owner occupier'']';
  elsif v_occ = 'hide' then
    v_where := v_where || ' and not coalesce(p.tags && array[''owner occupier''], false)';
  end if;

  -- ---------------------------------------------------------------- recently sold
  -- The cutoff compares against the latest TRANSFER comp (property_last_sales()), not
  -- properties.last_sale_date -- they are different numbers. No transfer comp at all
  -- rides on the companion toggle rather than being silently excluded.
  if v_sold_yrs is not null and v_sold_yrs > 0 then
    v_where := v_where || format(
      ' and not exists (select 1 from comps cx where cx.property_id = p.id'
      || ' and cx.kind = ''transfer'' and cx.as_of_date is not null'
      || ' and cx.as_of_date >= %L::date - (%s * 365.25)::int)', v_today, v_sold_yrs);
    if not v_no_sale then
      v_where := v_where || ' and exists (select 1 from comps cx where cx.property_id = p.id'
              || ' and cx.kind = ''transfer'' and cx.as_of_date is not null)';
    end if;
  end if;

  -- ---------------------------------------------------------------- owner + activity
  -- Both read property_owner_rollup, never v_property_owner_context: the live view is
  -- 13,596 ms as a whole-book predicate (see 20260823100000).
  -- Binary on purpose (Alex): either we can reach the owner today, or the parcel goes on
  -- the next skip-trace list. The phone/email checkmarks pick WHICH channel counts.
  if v_owner = 'verified' then
    parts := '{}';
    if v_ch_phone then parts := array_append(parts, 'r.owner_contact_verified'); end if;
    if v_ch_email then parts := array_append(parts, 'r.owner_email_verified'); end if;
    -- Both channels unticked is normalised away client-side; if it ever arrives, match
    -- nothing rather than silently matching everything.
    v_where := v_where || ' and exists (select 1 from property_owner_rollup r'
            || ' where r.property_id = p.id and ('
            || coalesce(nullif(array_to_string(parts, ' or '), ''), 'false') || '))';
  elsif v_owner = 'unverified' then
    v_where := v_where || ' and not exists (select 1 from property_owner_rollup r'
            || ' where r.property_id = p.id and r.owner_reachable)';
  end if;

  -- 30 days of ANY logged contact, matching the owner blast exactly. Never contacted
  -- counts as quiet -- it is the far end of the same axis, not a missing value.
  if v_activity = 'recent' then
    v_where := v_where || format(
      ' and exists (select 1 from property_owner_rollup r where r.property_id = p.id'
      || ' and r.last_contacted_at >= %L)', v_cutoff);
  elsif v_activity = 'quiet' then
    v_where := v_where || format(
      ' and not exists (select 1 from property_owner_rollup r where r.property_id = p.id'
      || ' and r.last_contacted_at >= %L)', v_cutoff);
  end if;

  -- ---------------------------------------------------------------- price
  -- For lease / for sale, priced by the CURRENT asking comp. The price question switches
  -- with the choice, and a listing priced only the OTHER way is the other kind of
  -- listing, so it fails. NOTE the existing trap, reproduced deliberately: such a listing
  -- is excluded even with "include listings without a price" ticked, because it is not
  -- FULLY unpriced. Do not "fix" this here -- it would change answers silently.
  if v_deal is not null then
    declare
      col text := case when v_deal = 'lease' then 'a.asking_lease_rate_psf' else 'a.sale_price' end;
      lo  numeric := case when v_deal = 'lease' then v_psf_min else v_price_min end;
      hi  numeric := case when v_deal = 'lease' then v_psf_max else v_price_max end;
      dt  text := case when v_deal = 'lease' then 'lease' else 'sale' end;
    begin
      v_where := v_where || ' and (exists (select 1 from v_property_current_asking a'
        || format(' where a.property_id = p.id and a.deal_type::text = %L and %s is not null', dt, col)
        || coalesce(format(' and %s >= %s', col, lo), '')
        || coalesce(format(' and %s <= %s', col, hi), '') || ')';
      if v_unpriced then
        v_where := v_where || ' or not exists (select 1 from v_property_current_asking a2'
          || ' where a2.property_id = p.id and (a2.asking_lease_rate_psf is not null'
          || ' or a2.sale_price is not null))';
      end if;
      v_where := v_where || ')';
    end;
  end if;

  -- ---------------------------------------------------------------- drawn shape
  -- point(x=lng, y=lat) -- swapping these silently returns nothing. The bbox is not
  -- pre-applied: the polygon operator over the (lat,lng) index is already selective, and
  -- a redundant bbox would only add planner noise.
  if v_poly is not null then
    v_where := v_where || format(
      ' and p.lat is not null and p.lng is not null and point(p.lng, p.lat) <@ %L::polygon', v_poly);
  end if;

  -- ---------------------------------------------------------------- lease windows
  -- All active lease criteria must hold on the SAME lease: a building with an old lease
  -- expiring soon and a new 5,000 SF one signed last month is NOT a match for "expires
  -- within 3 months AND 5,000 SF AND signed this year". Hence one EXISTS with every
  -- condition inside it, never several EXISTS.
  if v_lease_on and v_lease is not null and coalesce((v_lease->>'any')::boolean, false) then
    declare
      lm text := nullif(v_lease->>'month', '');
      lmin numeric := (v_lease->>'exp_min')::numeric;
      lmax numeric := (v_lease->>'exp_max')::numeric;
      smin numeric := (v_lease->>'sign_min')::numeric;
      smax numeric := (v_lease->>'sign_max')::numeric;
      lsf_min integer := (v_lease->>'sf_min')::integer;
      lsf_max integer := (v_lease->>'sf_max')::integer;
      dm text := nullif(v_lease->>'dm', 'all');
      cond text := 'l.property_id = p.id';
    begin
      if lm is not null then
        -- A calendar month OVERRIDES the rolling window: "September" is a month, not a
        -- span from today, and the two disagree about which leases belong to it.
        cond := cond || format(' and l.expiration_date is not null'
          || ' and to_char(l.expiration_date, ''YYYY-MM'') = %L', lm);
      elsif lmin is not null or lmax is not null then
        -- An empty minimum floors at TODAY (0 months), not epoch -- without it "expires
        -- within 3 months" drags in the ~700 leases that ran out years ago.
        cond := cond || format(' and l.expiration_date is not null and l.expiration_date >= %L::date + make_interval(months => %s)',
                               v_today, coalesce(lmin, 0)::int);
        if lmax is not null then
          cond := cond || format(' and l.expiration_date <= %L::date + make_interval(months => %s)',
                                 v_today, lmax::int);
        end if;
      end if;
      if smin is not null or smax is not null then
        -- Sign date runs the other way: months BACK from today.
        cond := cond || format(' and l.signed_date is not null and l.signed_date <= %L::date - make_interval(months => %s)',
                               v_today, coalesce(smin, 0)::int);
        if smax is not null then
          cond := cond || format(' and l.signed_date >= %L::date - make_interval(months => %s)',
                                 v_today, smax::int);
        end if;
      end if;
      if lsf_min is not null or lsf_max is not null then
        -- A lease with no recorded size cannot satisfy a size question.
        cond := cond || ' and l.sf is not null'
             || coalesce(format(' and l.sf >= %s', lsf_min), '')
             || coalesce(format(' and l.sf <= %s', lsf_max), '');
      end if;
      if dm = 'verified' then cond := cond || ' and coalesce(l.dm_verified, false)';
      elsif dm = 'unverified' then cond := cond || ' and not coalesce(l.dm_verified, false)';
      end if;
      v_where := v_where || ' and exists (select 1 from v_lease_comps l where ' || cond || ')';
    end;
  end if;

  -- ================================================================ the use axes
  -- Flagged, not filtered -- see the header. These four and only these four are what the
  -- overlay include-union may forgive.
  parts := '{}';
  if v_ptype is not null then
    parts := array_append(parts, format('p.property_type::text = %L', v_ptype));
  end if;
  if v_zoning is not null then
    if v_zoning = 'industrial_any' then
      -- the whole industrial universe: zoned for it OR already used as it (the
      -- grandfathered cohort belongs to "everything industrial" -- Alex)
      parts := array_append(parts, ('(' || c_zoned_ind
            || ' or (dor_class(p.dor_use_code) between 40 and 49 or dor_class(p.dor_use_code) = 27))'));
    elsif v_zoning = 'industrial' then
      parts := array_append(parts, c_zoned_ind);
    elsif v_zoning = 'non_industrial' then
      -- zoned, and not for industrial: the grandfathered test. 76.9% of the book has a
      -- NULL zoning_type and must fail every specific pick -- no answer is not a match.
      parts := array_append(parts, ('(p.zoning_type is not null and not ' || c_zoned_ind || ')'));
    else
      parts := array_append(parts, format('p.zoning_type::text = %L', v_zoning));
    end if;
  end if;
  if v_use_bucket is not null then
    parts := array_append(parts, format('(%s) = %L', c_bucket, v_use_bucket));
  end if;
  -- The DOR picker: four major categories as tri-state layers over the dor_codes filing,
  -- plus `extra` -- codes checked OUTSIDE those categories, matched verbatim per county
  -- when they are county-specific ('<county>|<raw>') or by normalized 3-digit code.
  if v_dor is not null and coalesce((v_dor->>'active')::boolean, false) then
    declare
      dparts text[] := '{}';
      extra text[] := coalesce(array(select jsonb_array_elements_text(v_dor->'extra')), '{}');
    begin
      if array_length(extra, 1) is not null then
        dparts := array_append(dparts, format(
          '(coalesce(p.county, '''') || ''|'' || coalesce(btrim(p.dor_use_code), '''')) = any(%L::text[])', extra));
        dparts := array_append(dparts, format(
          'lpad(dor_class(p.dor_use_code)::text, 3, ''0'') = any(%L::text[])', extra));
      end if;
      foreach k in array array['industrial', 'retail', 'office', 'multifamily'] loop
        sel := v_dor->k;
        if sel is null or sel = 'null'::jsonb then continue; end if;
        if jsonb_typeof(sel) = 'string' and sel #>> '{}' = 'all' then
          dparts := array_append(dparts, format(
            'exists (select 1 from dor_codes d where d.code = lpad(dor_class(p.dor_use_code)::text, 3, ''0'')'
            || ' and d.category = %L)', k));
        elsif jsonb_typeof(sel) = 'array' then
          dparts := array_append(dparts, format(
            'lpad(dor_class(p.dor_use_code)::text, 3, ''0'') = any(%L::text[])',
            coalesce(array(select jsonb_array_elements_text(sel)), '{}')));
        end if;
      end loop;
      if array_length(dparts, 1) is null then
        -- picker active but nothing selected: match nothing, never everything
        parts := array_append(parts, 'false');
      else
        parts := array_append(parts, ('(btrim(coalesce(p.dor_use_code, '''')) <> '''' and ('
               || array_to_string(dparts, ' or ') || '))'));
      end if;
    end;
  end if;
  if array_length(parts, 1) is not null then
    v_use := array_to_string(parts, ' and ');
  end if;

  -- ================================================================ overlays
  -- Membership is the row's OWN (jurisdiction, code) -- the shapes and properties.zoning_*
  -- come from the same pipeline. NEVER point-in-polygon against the overlay.
  if v_ov is not null then
    declare
      inc text[] := '{}';
      onl text[] := '{}';
      frag text;
      t text;
      mode text;
    begin
      for t, sel, mode in
        select e.key, e.value->'sel', e.value->>'mode' from jsonb_each(v_ov) e
      loop
        if sel is null then continue; end if;
        if jsonb_typeof(sel) = 'array' then
          frag := format('(p.zoning_jurisdiction is not null and p.zoning_code is not null'
                 || ' and (p.zoning_jurisdiction || ''|'' || p.zoning_code) = any(%L::text[]))',
                 coalesce(array(select jsonb_array_elements_text(sel)), '{}'));
        elsif sel #>> '{}' = 'all' then
          if t = 'industrial' then
            frag := c_zoned_ind;
          elsif t = 'retail' then
            -- the crossovers live under Industrial, and still carry zoning_type='retail';
            -- exclude them so the shapes and the union agree what "retail" contains
            frag := '(p.zoning_type = ''retail'' and not ' || c_zoned_ind || ')';
          else
            frag := format('p.zoning_type::text = %L', t);
          end if;
        else
          continue;
        end if;
        if mode = 'include' or mode = 'both' then inc := array_append(inc, frag); end if;
        if mode = 'only'    or mode = 'both' then onl := array_append(onl, frag); end if;
      end loop;
      if array_length(inc, 1) is not null then v_ovi := '(' || array_to_string(inc, ' or ') || ')'; end if;
      if array_length(onl, 1) is not null then v_ovo := '(' || array_to_string(onl, ' or ') || ')'; end if;
    end;
  end if;

  return jsonb_build_object('where', v_where, 'use', v_use, 'ovi', v_ovi, 'ovo', v_ovo,
                            'portfolio', false);
end $fn$;

revoke all on function public.warroom_predicate(jsonb) from public, anon;
grant execute on function public.warroom_predicate(jsonb) to authenticated;

comment on function public.warroom_predicate(jsonb) is
  'Builds the War Room''s whole filter set as SQL fragments: {where, use, ovi, ovo}. '
  'Returns fragments rather than rows so warroom_page, warroom_counts and warroom_ids '
  'share ONE copy of the rules -- a page of 100 is an indexed LIMIT while an exact total '
  'must walk the matching set, and fusing them would make first paint wait on the count. '
  'Touches no data, so it is IMMUTABLE and not definer; its three callers are definer '
  '(numeric operators are not leakproof, so under RLS no numeric predicate can use an '
  'index) and each re-asserts is_va() by hand.';
