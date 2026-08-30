-- Deal-flag engine v2 (2026-08-29). Approved by Alex: F1 ("make it actually run"),
-- F3 reframed by him ("our math can get better — if it's a small unit in a big building
-- judge it based on small units; for wetlands judge based on similar lowlands/highlands
-- ratios"), F5 ("sounds good so go ahead"). Audit: context/deal-flags-and-unit-sf-2026-08-29.md.
--
-- What was wrong: flag_deal_candidates read the LIVE v_property_market_position at
-- 7.2–7.5s against the 8s PostgREST timeout — it silently ran ~never for six weeks, then
-- dumped 84 backlogged flags in one batch; its "expected" price was an attribute-blind
-- asking-median power law (land on gross acres, unit rates judged in a whole-building
-- frame); pending flags never expired.
--
-- The new engine:
--   * expected values come from estimate_property_value (comp-weighted, asking-haircut,
--     land on USABLE acres with the measured β — a wet parcel is judged like other wet
--     parcels because both sides of every land comparison are usable-acre based);
--   * a lease listing offering a SPACE is judged at the space's size: the building-level
--     rate is restated by (space_sf / building_sf)^β with the measured lease elasticity,
--     so a 2,936 SF unit is compared against small-space pricing, not big-box medians;
--   * per-property evals are tracked in deal_flag_evals; a property re-evaluates when a
--     NEW asking comp appears (the ingest only mints one on a price change), when marked
--     stale, or every 14 days;
--   * work runs in nightly batches through the sanctioned n8n-kick → self-unscheduling
--     one-off pg_cron pattern (never a persistent jobid; the silent-wedge lesson) — no
--     PostgREST timeout in the path;
--   * a pending flag whose listing no longer qualifies flips to 'expired' (machine-set,
--     reversible); 'dismissed' is Alex's judgement and is NEVER touched or resurrected.
--
-- flag_deal_candidates keeps its name/signature (the dashboard Scan button and the n8n
-- sweep both call it): it now just marks its target set stale and kicks the one-off —
-- returning {queued: n} instead of blocking for 7s.

alter type deal_flag_status add value if not exists 'expired';

-- ---------------------------------------------------------------------------
-- Eval ledger
-- ---------------------------------------------------------------------------

create table if not exists deal_flag_evals (
  property_id uuid primary key references properties(id) on delete cascade,
  evaluated_at timestamptz not null default now(),
  stale boolean not null default false,
  lease_pct numeric,
  sale_pct numeric,
  land_pct numeric,
  -- What the comparison actually was, for the day a flag looks odd.
  detail jsonb
);

alter table deal_flag_evals enable row level security;

create policy deal_flag_evals_auth_all on deal_flag_evals
  for all to authenticated using (true) with check (true);

create policy deal_flag_evals_va_deny on deal_flag_evals
  as restrictive for all to authenticated
  using ((select not public.is_va())) with check ((select not public.is_va()));

-- ---------------------------------------------------------------------------
-- Tunables
-- ---------------------------------------------------------------------------

insert into valuation_params (key, value, notes) values
  ('flag_min_discount_pct', 20,
   'A listing must ask at least this % under its estimate to flag as a deal.'),
  ('flag_max_discount_pct', 70,
   'Deeper than this is presumed to be bad data, not a deal (the old -70 sanity band).'),
  ('flag_min_comps', 4,
   'Estimate side must rest on at least this many comps before it can flag a deal.'),
  ('flag_batch_size', 400,
   'Properties re-evaluated per nightly one-off cron run (~1.5s each).'),
  ('flag_refresh_days', 14,
   'A quiet listing is re-evaluated at least this often (price changes re-evaluate next run).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The evaluator: batch over the stalest candidates, one estimate each
-- ---------------------------------------------------------------------------

create or replace function public.run_deal_flag_evals(p_limit int default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_limit int;
  v_min numeric; v_max numeric; v_min_n int; v_refresh_days int;
  v_betas jsonb;
  v_row record;
  v_val jsonb;
  v_lease_pct numeric; v_sale_pct numeric; v_land_pct numeric;
  v_detail jsonb;
  v_ask_rate numeric; v_ask_rate_max numeric; v_space_sf numeric; v_bldg numeric;
  v_beta numeric; v_restate numeric; v_expected numeric;
  v_ask_price numeric; v_est numeric; v_n int;
  v_evaluated int := 0; v_flagged int := 0; v_expired int := 0;
  v_qualifies boolean;
begin
  select coalesce((select value from valuation_params where key='flag_batch_size'), 400) into v_limit;
  v_limit := coalesce(p_limit, v_limit::int);
  select coalesce((select value from valuation_params where key='flag_min_discount_pct'), 20) into v_min;
  select coalesce((select value from valuation_params where key='flag_max_discount_pct'), 70) into v_max;
  select coalesce((select value from valuation_params where key='flag_min_comps'), 4)::int into v_min_n;
  select coalesce((select value from valuation_params where key='flag_refresh_days'), 14)::int into v_refresh_days;

  -- v_comp_size_elasticity runs a regression per query — hoist ONCE per batch, never
  -- per property (the 2026-08-12 inlined-CTE lesson, same trap different door).
  select coalesce(jsonb_object_agg(ptype, beta) filter (where bucket='lease'), '{}'::jsonb)
    into v_betas from v_comp_size_elasticity;

  for v_row in
    select p.id, p.property_type::text as ptype,
           coalesce(p.gross_sf, p.heated_sf)::numeric as bldg_sf,
           e.evaluated_at, e.stale
      from properties p
      left join deal_flag_evals e on e.property_id = p.id
     where p.source = 'scrape'
       and p.listing_status = 'on_market'
       and length(p.address) > 2
       and p.address not ilike 'parcel %'
       and exists (select 1 from comps c where c.property_id = p.id and c.kind = 'asking')
       and (e.property_id is null
            or e.stale
            or e.evaluated_at < now() - make_interval(days => v_refresh_days)
            or exists (select 1 from comps c where c.property_id = p.id
                         and c.kind = 'asking' and c.created_at > e.evaluated_at))
     order by (e.property_id is null) desc, e.stale desc nulls last, e.evaluated_at asc nulls first
     limit v_limit
  loop
    begin
      v_lease_pct := null; v_sale_pct := null; v_land_pct := null; v_detail := '{}'::jsonb;
      v_val := estimate_property_value(v_row.id);

      -- LEASE: judge the offered SPACE at its own size.
      select a.asking_lease_rate_psf, c2.asking_lease_rate_psf_max, a.sf
        into v_ask_rate, v_ask_rate_max, v_space_sf
        from v_property_current_asking a
        join comps c2 on c2.id = a.comp_id
       where a.property_id = v_row.id and a.deal_type = 'lease';
      if v_ask_rate is not null and v_val->'lease' is not null
         and (v_val->'lease'->>'n')::int >= v_min_n then
        v_est := (v_val->'lease'->>'psf')::numeric;
        v_bldg := v_row.bldg_sf;
        v_beta := coalesce((v_betas->>coalesce(v_row.ptype,''))::numeric, -0.15);
        -- Restate the building-level rate to the space size (small spaces rent higher
        -- PSF). Only when the listing is clearly a partial availability; clamped so the
        -- measured curve is interpolated, not trusted to extremes.
        if v_space_sf is not null and v_bldg > 0 and v_space_sf > 0
           and v_space_sf < 0.95 * v_bldg then
          v_restate := least(1.6, greatest(0.75, power(v_space_sf / v_bldg, v_beta)));
        else
          v_restate := 1.0;
        end if;
        v_expected := v_est * v_restate;
        if v_expected > 0 then
          -- Judge the range MIDPOINT when a range is advertised — "$8-$15" is not an $8 deal.
          v_lease_pct := round(((coalesce((v_ask_rate + coalesce(v_ask_rate_max, v_ask_rate)) / 2, v_ask_rate)
                                 / v_expected) - 1) * 100, 0);
          v_detail := v_detail || jsonb_build_object('lease', jsonb_build_object(
            'ask_low', v_ask_rate, 'ask_high', v_ask_rate_max, 'space_sf', v_space_sf,
            'building_sf', v_bldg, 'est_psf', v_est, 'restate', round(v_restate, 3),
            'expected_psf', round(v_expected, 2), 'n', (v_val->'lease'->>'n')::int));
        end if;
      end if;

      -- SALE on an improved building: asking price vs the estimate's total.
      select a.sale_price into v_ask_price
        from v_property_current_asking a
       where a.property_id = v_row.id and a.deal_type = 'sale';
      if v_ask_price is not null and v_val->'sale' is not null
         and (v_val->'sale'->>'n')::int >= v_min_n
         and (v_val->'sale'->>'total') is not null then
        v_est := (v_val->'sale'->>'total')::numeric;
        if v_est > 0 then
          v_sale_pct := round(((v_ask_price / v_est) - 1) * 100, 0);
          v_detail := v_detail || jsonb_build_object('sale', jsonb_build_object(
            'ask', v_ask_price, 'estimate', v_est, 'n', (v_val->'sale'->>'n')::int));
        end if;
      end if;

      -- LAND: asking price vs the usable-acre estimate. Wet parcels are judged on the
      -- same usable basis their comps were priced on — Alex's lowlands/highlands rule.
      if v_ask_price is not null and v_val->'land' is not null
         and (v_val->'land'->>'n')::int >= v_min_n
         and (v_val->'land'->>'total') is not null then
        v_est := (v_val->'land'->>'total')::numeric;
        if v_est > 0 then
          v_land_pct := round(((v_ask_price / v_est) - 1) * 100, 0);
          v_detail := v_detail || jsonb_build_object('land', jsonb_build_object(
            'ask', v_ask_price, 'estimate', v_est,
            'basis', v_val->'land'->>'acres_basis', 'basis_acres', v_val->'land'->>'basis_acres',
            'n', (v_val->'land'->>'n')::int));
        end if;
      end if;

      -- Keep a side's pct only when it sits inside the deal band.
      v_lease_pct := case when v_lease_pct between -v_max and -v_min then v_lease_pct end;
      v_sale_pct  := case when v_sale_pct  between -v_max and -v_min then v_sale_pct  end;
      v_land_pct  := case when v_land_pct  between -v_max and -v_min then v_land_pct  end;
      v_qualifies := v_lease_pct is not null or v_sale_pct is not null or v_land_pct is not null;

      insert into deal_flag_evals as e (property_id, evaluated_at, stale, lease_pct, sale_pct, land_pct, detail)
      values (v_row.id, now(), false, v_lease_pct, v_sale_pct, v_land_pct, v_detail)
      on conflict (property_id) do update
        set evaluated_at = now(), stale = false,
            lease_pct = excluded.lease_pct, sale_pct = excluded.sale_pct,
            land_pct = excluded.land_pct, detail = excluded.detail;

      if v_qualifies then
        insert into deal_flags as f (property_id, lease_vs_market_pct, sale_vs_market_pct, land_vs_market_pct)
        values (v_row.id, v_lease_pct, v_sale_pct, v_land_pct)
        on conflict (property_id) do update
          set lease_vs_market_pct = excluded.lease_vs_market_pct,
              sale_vs_market_pct  = excluded.sale_vs_market_pct,
              land_vs_market_pct  = excluded.land_vs_market_pct,
              -- dismissed is Alex's call and stays dismissed forever; expired may return.
              status = case when f.status = 'dismissed' then f.status else 'pending' end,
              created_at = case when f.status = 'expired' then now() else f.created_at end,
              updated_at = now();
        v_flagged := v_flagged + 1;
      else
        update deal_flags set status = 'expired', updated_at = now()
         where property_id = v_row.id and status = 'pending';
        if found then v_expired := v_expired + 1; end if;
      end if;

      v_evaluated := v_evaluated + 1;
    exception when others then
      -- One broken property must not kill the batch; record and move on.
      insert into deal_flag_evals as e (property_id, evaluated_at, stale, detail)
      values (v_row.id, now(), false, jsonb_build_object('error', sqlerrm))
      on conflict (property_id) do update
        set evaluated_at = now(), stale = false,
            detail = jsonb_build_object('error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('evaluated', v_evaluated, 'flagged', v_flagged, 'expired', v_expired);
end $$;

revoke execute on function public.run_deal_flag_evals(int) from public, anon, authenticated;
grant execute on function public.run_deal_flag_evals(int) to service_role;

-- ---------------------------------------------------------------------------
-- The kick: n8n-kicked self-unscheduling one-off (the market-refresh pattern)
-- ---------------------------------------------------------------------------

create or replace function public.kick_deal_flag_evals()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_when timestamp := timezone('UTC', now()) + interval '2 minutes';
  v_cron text := format('%s %s * * *', extract(minute from v_when)::int, extract(hour from v_when)::int);
begin
  perform cron.schedule('deal-flag-evals-once', v_cron,
    $job$set statement_timeout = '20min'; select public.run_deal_flag_evals(); select cron.unschedule('deal-flag-evals-once');$job$);
  return 'deal-flag-evals-once scheduled at ' || v_cron || ' UTC';
end $$;

revoke execute on function public.kick_deal_flag_evals() from public, anon, authenticated;
grant execute on function public.kick_deal_flag_evals() to service_role;

-- ---------------------------------------------------------------------------
-- flag_deal_candidates: same name and signature, new job — mark stale + kick.
-- Callers: dashboard Scan button (authenticated, {p_days}) and the n8n sweep
-- ({p_property_ids} = every id the sweep touched).
-- ---------------------------------------------------------------------------

create or replace function public.flag_deal_candidates(p_property_ids uuid[] default null::uuid[], p_days integer default 14)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_queued int := 0;
begin
  with targets as (
    select p.id from properties p
     where p.source = 'scrape'
       and p.listing_status = 'on_market'
       and case when p_property_ids is not null
             then p.id = any(p_property_ids)
             else p.created_at > now() - make_interval(days => greatest(p_days, 1))
           end
  ), marked as (
    -- Promote to the front of the queue ONLY where something actually changed (a new
    -- asking comp = a price change; the ingest only mints one on change). The sweep
    -- passes EVERY seen id nightly — blanket stale-marking would churn the whole book
    -- through the 400/night budget forever and starve the 14-day refresh.
    update deal_flag_evals e set stale = true
      from targets t
     where e.property_id = t.id
       and exists (select 1 from comps c
                    where c.property_id = e.property_id
                      and c.kind = 'asking'
                      and c.created_at > e.evaluated_at)
    returning 1
  )
  select (select count(*) from targets) into v_queued;

  perform kick_deal_flag_evals();

  -- deals_flagged kept for the existing UI contract (it reads `deals_flagged ?? 0`);
  -- actual flags land when the one-off runs, a couple of minutes from now.
  return jsonb_build_object('deals_flagged', 0, 'queued', v_queued);
end $$;
