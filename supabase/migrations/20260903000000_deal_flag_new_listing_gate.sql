-- Deal-flag engine: gate flagging to NEW listings.
--
-- Regression fix. v2 (20260829181000) moved flag creation into run_deal_flag_evals
-- but dropped v1's created_at gate, so the whole on-market book (~3,700 listings)
-- got first-flagged, not just new ones — the flood of pending deal_flags on the
-- dashboard. v1's intent was to flag scraped listings as they come in. Restore that:
--   * the never-evaluated bootstrap branch only fires for listings < flag_new_listing_days old
--   * a flag is only MINTED for a new listing (an already-flagged property still refreshes)
-- Everything else is untouched: re-listings still flag via the new-asking-comp branch,
-- stale/refresh re-evaluation still expires flags that no longer qualify, and dismissed
-- flags still stay dismissed forever. An old listing that newly qualifies falls to the
-- ELSE, whose expire-if-pending is a safe no-op when it has no flag.

insert into valuation_params (key, value)
values ('flag_new_listing_days', '14')
on conflict (key) do nothing;

create or replace function public.run_deal_flag_evals(p_limit int default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_limit int;
  v_min numeric; v_max numeric; v_min_n int; v_refresh_days int; v_new_days int; v_is_new boolean;
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
  select coalesce((select value from valuation_params where key='flag_new_listing_days'), 14)::int into v_new_days;

  -- v_comp_size_elasticity runs a regression per query — hoist ONCE per batch, never
  -- per property (the 2026-08-12 inlined-CTE lesson, same trap different door).
  select coalesce(jsonb_object_agg(ptype, beta) filter (where bucket='lease'), '{}'::jsonb)
    into v_betas from v_comp_size_elasticity;

  for v_row in
    select p.id, p.property_type::text as ptype,
           coalesce(p.gross_sf, p.heated_sf)::numeric as bldg_sf,
           e.evaluated_at, e.stale, p.created_at
      from properties p
      left join deal_flag_evals e on e.property_id = p.id
     where p.source = 'scrape'
       and p.listing_status = 'on_market'
       and length(p.address) > 2
       and p.address not ilike 'parcel %'
       and exists (select 1 from comps c where c.property_id = p.id and c.kind = 'asking')
       and ((e.property_id is null and p.created_at > now() - make_interval(days => v_new_days))
            or e.stale
            or e.evaluated_at < now() - make_interval(days => v_refresh_days)
            or exists (select 1 from comps c where c.property_id = p.id
                         and c.kind = 'asking' and c.created_at > e.evaluated_at))
     order by (e.property_id is null) desc, e.stale desc nulls last, e.evaluated_at asc nulls first
     limit v_limit
  loop
    begin
      v_lease_pct := null; v_sale_pct := null; v_land_pct := null; v_detail := '{}'::jsonb;
      v_is_new := v_row.created_at > now() - make_interval(days => v_new_days);
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

      if v_qualifies and (v_is_new or exists (select 1 from deal_flags d where d.property_id = v_row.id)) then
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
