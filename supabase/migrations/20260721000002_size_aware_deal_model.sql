-- Smarter, size-weighted deal detection.
--
-- Problem 1 (size): v_property_market_position compared every listing's $/SF to a flat
-- COUNTY-WIDE median (property_type IS NULL). Because bigger buildings/lots trade at a lower
-- $/SF (economies of scale), large properties always looked "below market" (false deal) and
-- small ones "above market" (missed deals); it also blended all property types.
-- Problem 2 (noise): a flat "15% below median" bar flags the entire below-median tail, and the
-- worst offenders are DATA ERRORS (mis-parsed price/SF, or land plays with a tiny building whose
-- $/SF is meaningless), which the size model amplifies.
--
-- Fix: compare each listing to a SIZE-adjusted, TYPE- and COUNTY-aware EXPECTED price
--     expected_psf(sf) = type_median_psf * county_factor * (sf / type_median_sf) ^ b
--   b = log-log price/size elasticity fit live from ALL comps per (type, deal): industrial
--   lease -0.21, industrial sale -0.28, land per-acre -0.58. Clamped [-0.7,0] / [-0.8,0].
--   A "good deal" is a BAND — 25%..55% below the size-adjusted expected — with absolute $/SF
--   floors and a land-coverage guard so data errors and land plays don't flag. Output columns
--   are unchanged (the *_baseline_median columns hold the per-property expected price).

create or replace view public.v_property_market_position as
with
elast_bldg as (
  select ptype, dt, greatest(-0.7, least(0, regr_slope(ly, lx)))::numeric as b
  from (
    select p.property_type::text ptype, c.deal_type::text dt,
      ln(c.sf::numeric) lx,
      ln(nullif(case when c.deal_type = 'lease'
                       then coalesce(c.executed_lease_rate_psf, c.asking_lease_rate_psf)
                     else coalesce(c.price_per_sf, case when c.sf > 0 then c.sale_price / c.sf end) end, 0)::numeric) ly
    from comps c
    join properties p on p.id = c.property_id
    where c.sf is not null and c.sf > 300 and p.property_type is not null
  ) q
  where ly is not null and lx is not null
  group by ptype, dt
  having count(*) >= 30
),
elast_land as (
  select greatest(-0.8, least(0, coalesce(regr_slope(ly, lx), 0)))::numeric as b
  from (
    select ln(c.land_acres::numeric) lx,
      ln(nullif(coalesce(c.price_per_acre, case when c.land_acres > 0 then c.sale_price / c.land_acres end), 0)::numeric) ly
    from comps c
    join properties p on p.id = c.property_id
    where c.deal_type = 'sale' and p.property_type::text = 'land' and c.land_acres > 0.05
  ) q
  where ly is not null and lx is not null
),
ref as (
  select p.id, p.county, p.property_type::text ptype, p.building_sf::numeric bsf, p.land_acres,
    cal.asking_lease_rate_psf as lease_psf,
    coalesce(cal.sf, p.building_sf)::numeric as lease_sf,
    case when cas.sale_price is not null and coalesce(cas.sf, p.building_sf) > 0
         then round(cas.sale_price / coalesce(cas.sf, p.building_sf)::numeric, 2) end as sale_psf,
    coalesce(cas.sf, p.building_sf)::numeric as sale_sf,
    case when cas.sale_price is not null and p.land_acres > 0 and p.property_type::text = 'land'
         then round(cas.sale_price / p.land_acres, 0) end as land_ppa
  from properties p
  left join v_property_current_asking cal on cal.property_id = p.id and cal.deal_type = 'lease'
  left join v_property_current_asking cas on cas.property_id = p.id and cas.deal_type = 'sale'
  where p.county is not null
),
lease_t  as (select ptype, percentile_cont(0.5) within group (order by lease_psf)::numeric m,
                     percentile_cont(0.5) within group (order by lease_sf)::numeric s, count(*) n
             from ref where lease_psf > 0 and lease_sf > 0 group by ptype),
sale_t   as (select ptype, percentile_cont(0.5) within group (order by sale_psf)::numeric m,
                     percentile_cont(0.5) within group (order by sale_sf)::numeric s, count(*) n
             from ref where sale_psf > 0 and sale_sf > 0 group by ptype),
land_t   as (select percentile_cont(0.5) within group (order by land_ppa)::numeric m,
                    percentile_cont(0.5) within group (order by land_acres)::numeric s, count(*) n
             from ref where land_ppa > 0 and land_acres > 0),
lease_ct as (select county, ptype, percentile_cont(0.5) within group (order by lease_psf)::numeric m, count(*) n
             from ref where lease_psf > 0 group by county, ptype),
sale_ct  as (select county, ptype, percentile_cont(0.5) within group (order by sale_psf)::numeric m, count(*) n
             from ref where sale_psf > 0 group by county, ptype),
land_c   as (select county, percentile_cont(0.5) within group (order by land_ppa)::numeric m, count(*) n
             from ref where land_ppa > 0 group by county),
expected as (
  select r.id, r.county, r.ptype, r.bsf, r.land_acres, r.lease_psf, r.sale_psf, r.land_ppa,
    lt.n as lease_n, st.n as sale_n, landt.n as land_n,
    case when lt.m > 0 and r.lease_sf > 0 and lt.s > 0 then
      lt.m * (case when lct.n >= 5 and lt.m > 0 then least(2.0, greatest(0.5, lct.m / lt.m)) else 1 end)
           * power(r.lease_sf / lt.s, coalesce(elb_l.b, 0)) end as exp_lease,
    case when st.m > 0 and r.sale_sf > 0 and st.s > 0 then
      st.m * (case when sct.n >= 5 and st.m > 0 then least(2.0, greatest(0.5, sct.m / st.m)) else 1 end)
           * power(r.sale_sf / st.s, coalesce(elb_s.b, 0)) end as exp_sale,
    case when landt.m > 0 and r.land_acres > 0 and landt.s > 0 then
      landt.m * (case when lc.n >= 5 and landt.m > 0 then least(2.0, greatest(0.5, lc.m / landt.m)) else 1 end)
              * power(r.land_acres / landt.s, coalesce(el.b, 0)) end as exp_land,
    -- building covers a real fraction of the lot (else it's a land play; $/SF meaningless)
    (r.land_acres is null or r.land_acres <= 0 or r.bsf is null
       or r.bsf / (r.land_acres * 43560) >= 0.03) as real_building
  from ref r
  left join lease_t  lt   on lt.ptype = r.ptype
  left join lease_ct lct  on lct.county = r.county and lct.ptype = r.ptype
  left join elast_bldg elb_l on elb_l.ptype = r.ptype and elb_l.dt = 'lease'
  left join sale_t   st   on st.ptype = r.ptype
  left join sale_ct  sct  on sct.county = r.county and sct.ptype = r.ptype
  left join elast_bldg elb_s on elb_s.ptype = r.ptype and elb_s.dt = 'sale'
  cross join land_t landt
  cross join elast_land el
  left join land_c lc on lc.county = r.county
)
select id, county, ptype as property_type,
  lease_psf as asking_rate_psf,
  round(exp_lease, 2) as lease_baseline_median,
  lease_n as lease_baseline_n,
  case when lease_psf > 0 and ptype is distinct from 'land' and exp_lease > 0 and lease_n >= 20
       then round((lease_psf - exp_lease) / exp_lease * 100, 0) end as lease_vs_market_pct,
  (lease_psf >= 3 and ptype is distinct from 'land' and exp_lease > 0 and lease_n >= 20
     and lease_psf <= exp_lease * 0.75 and lease_psf >= exp_lease * 0.45) as good_lease_deal,
  sale_psf,
  round(exp_sale, 2) as sale_baseline_median,
  sale_n as sale_baseline_n,
  case when sale_psf > 0 and ptype is distinct from 'land' and exp_sale > 0 and sale_n >= 20
       then round((sale_psf - exp_sale) / exp_sale * 100, 0) end as sale_vs_market_pct,
  (sale_psf >= 15 and ptype is distinct from 'land' and exp_sale > 0 and sale_n >= 20 and real_building
     and sale_psf <= exp_sale * 0.75 and sale_psf >= exp_sale * 0.45) as good_sale_deal,
  land_ppa as land_per_acre,
  round(exp_land, 0) as land_baseline_median,
  land_n as land_baseline_n,
  case when land_ppa > 0 and exp_land > 0 and land_n >= 20
       then round((land_ppa - exp_land) / exp_land * 100, 0) end as land_vs_market_pct,
  (land_ppa >= 5000 and exp_land > 0 and land_n >= 20
     and land_ppa <= exp_land * 0.75 and land_ppa >= exp_land * 0.45) as good_land_deal
from expected;
