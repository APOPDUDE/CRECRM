-- Land valuation L1 (2026-08-29): make the land path honest. Approved by Alex
-- ("you can build phase 1"). Assessment: context/land-valuation-assessment-2026-08-29.md.
--
-- What changes (land bucket / vacant subjects only — improved subjects are
-- fingerprint-verified unchanged, see _fp_land_pre/post_20260829):
--
--   1. USABLE-ACRES BASIS. A land comp's $/acre is now computed on its own usable
--      (upland) acres, and the subject's total is rate × subject usable acres — both
--      sides of the division agree, and the card no longer shows a rate the engine
--      never used. A parcel measured half-wet (0 Airport Rd: 9.93 gross / 7.32 usable)
--      stops being priced as if every acre were dry. Below 0.05 usable acres we fall
--      back to gross so a bad polygon can't zero a parcel; comps apply the property's
--      usable FRACTION to the comp's own recorded acres (comp acres and property
--      acres can differ — assemblages, partial sales).
--   2. MEASURED SIZE DECAY. v_comp_size_elasticity gains a land branch (banded per
--      the 2026-08-13 lesson: acres 0.2-500, price $25K-$60M, $/usable-acre
--      $5K-$5M). Measured on 2026-08-29: beta -0.497, r -0.61, n=1,324 (asking-only
--      -0.491 vs executed-only -0.575 — the kinds agree). The RPC's -0.15 fallback
--      remains for the day the measurement fails: a slope outside [-0.9, -0.05]
--      returns NULL (clamp-as-alarm — a pinned value is a failed measurement, never
--      a steep one). Per-comp size_adj clamps widen for land ([0.35, 2.5], params)
--      because land comps legitimately span 100× size ratios; the σ=0.6 kernel
--      already strips weight from dissimilar sizes before the clamp matters.
--   3. HONEST CONFIDENCE (land bucket only). 'high' now additionally requires at
--      least one executed comp and no single comp carrying more than
--      land_conc_cap_pct (35%) of the weight; asking-only with one comp above 50%
--      reads 'low'. The node says WHY: asking_only + top_weight_pct are returned.
--      (The Polk sample that read "high" on 18 asking comps, one at 59.6%, now
--      reads what it is.)
--   4. LAND RENT LINE. A vacant subject now gets the IOS yard-rent estimate the
--      county table already priced for improved yards: usable acres (capped at
--      land_rent_max_acres, decayed) × county_land_rents rate, returned in the land
--      node as rent_monthly/rent_per_acre_month/rent_source. Framed in the UI as
--      "if let as yard" — wooded raw ground needs site work first.
--   5. Tax basis: a buildingless subject typed non-land (industrial-typed dirt) now
--      bases its tax on the land estimate instead of returning null.
--   6. Subject node carries zoning_code/zoning_description (5% coverage today —
--      shown when present). FLU stays out until parcel_enrichment's FLU importer
--      lands (columns exist, 0 rows populated as of 2026-08-29); wiring attributes
--      into the MATH is Phase L2.
--
-- Comp-row shape: rows gain eff_acres + acres_basis (land rows show which basis
-- priced them). Estimate math for lease/sale buckets is untouched.

-- ---------------------------------------------------------------------------
-- 1. Size elasticity: add the measured land branch.
--    Buildings branch is byte-identical to 20260815175411 (kind allowlist kept).
-- ---------------------------------------------------------------------------

create or replace view v_comp_size_elasticity as
with q as (
  select p.property_type::text as ptype,
         case when coalesce(c.executed_lease_rate_psf, c.asking_lease_rate_psf) > 0 then 'lease' else 'sale' end as bucket,
         ln(coalesce(c.sf, p.gross_sf)::numeric) as lx,
         ln(nullif(
           case when coalesce(c.executed_lease_rate_psf, c.asking_lease_rate_psf) > 0
                then coalesce(c.executed_lease_rate_psf, c.asking_lease_rate_psf)
                else coalesce(c.price_per_sf, c.sale_price / nullif(coalesce(c.sf, p.gross_sf), 0))
           end, 0)) as ly
  from comps c
  join properties p on p.id = c.property_id
  where c.kind in ('asking'::comp_kind, 'executed'::comp_kind)
    and coalesce(c.sf, p.gross_sf) between 800 and 500000
    and p.property_type is not null
    and p.property_type::text <> 'land'
    and (
      coalesce(c.executed_lease_rate_psf, c.asking_lease_rate_psf) between 3 and 60
      or coalesce(c.price_per_sf, c.sale_price / nullif(coalesce(c.sf, p.gross_sf), 0)) between 25 and 500
    )
),
buildings as (
  select ptype, bucket, count(*) as n,
         greatest(-0.35::numeric, least(0::numeric, regr_slope(ly::float8, lx::float8)::numeric)) as beta
  from q
  where ly is not null and lx is not null
  group by ptype, bucket
  having count(*) >= 25
),
-- Land: ln($/usable-acre) on ln(usable acres), banded. The usable fraction comes
-- from the comp PROPERTY's measurement, applied to the comp's own acres.
lp as (
  select coalesce(c.land_acres, p.land_acres)::numeric as gross_ac,
         case when p.land_acres > 0 and p.usable_acres is not null
              then greatest(0::numeric, least(1::numeric, p.usable_acres / p.land_acres))
              else 1 end as frac,
         coalesce(c.sale_price, c.price_per_acre * coalesce(c.land_acres, p.land_acres))::numeric as price
  from comps c
  join properties p on p.id = c.property_id
  where c.kind in ('asking'::comp_kind, 'executed'::comp_kind)
    and p.property_type::text = 'land'
    and coalesce(c.executed_at, c.as_of_date, c.created_at::date) >= current_date - interval '6 years'
),
le as (
  select case when gross_ac * frac > 0.05 then gross_ac * frac else gross_ac end as eff_ac, price
  from lp
  where gross_ac between 0.2 and 500 and price between 25000 and 60000000
),
lg as (
  select ln(eff_ac::float8) as lx, ln((price / eff_ac)::float8) as ly
  from le
  where price / eff_ac between 5000 and 5000000
),
land as (
  select 'land'::text as ptype, 'sale'::text as bucket, count(*) as n,
         -- Clamp-as-alarm: outside the plausible window the measurement FAILED —
         -- return no row and let the RPC fall back, never a pinned value.
         case when regr_slope(ly, lx)::numeric between -0.9 and -0.05
              then round(regr_slope(ly, lx)::numeric, 4) end as beta
  from lg
  having count(*) >= 100
)
select ptype, bucket, n, beta from buildings
union all
select ptype, bucket, n, beta from land where beta is not null;

comment on view v_comp_size_elasticity is
  'Per property_type x lease|sale: regression of ln(rate) on ln(size). Buildings: banded [800,500K] SF, land excluded, clamped [-0.35, 0]. Land (ptype=land, bucket=sale): ln($/usable-acre) on ln(usable acres), banded acres [0.2,500] / price [$25K,$60M] / rate [$5K,$5M]-per-acre; a slope outside [-0.9,-0.05] is a FAILED measurement and yields no row (RPC falls back to -0.15). Measured 2026-08-29: -0.497 (n=1,324, r -0.61).';

-- ---------------------------------------------------------------------------
-- 2. New tunables. on conflict do nothing: an operator UPDATE is never clobbered.
-- ---------------------------------------------------------------------------

insert into valuation_params (key, value, notes) values
  ('land_size_adj_min', 0.35,
   'Floor on the per-comp land size adjustment. Wider than buildings ([0.75,1.4]): land comps legitimately span 100x size ratios and the sigma=0.6 kernel already strips weight from dissimilar sizes; at measured beta -0.5 a [0.6,1.6] clamp would truncate any ratio past ~2.8x.'),
  ('land_size_adj_max', 2.50,
   'Cap on the per-comp land size adjustment (see land_size_adj_min).'),
  ('land_conc_cap_pct', 35,
   'A land estimate cannot read high confidence when one comp carries more than this % of the weight. The Polk sample read high on 18 asking comps with one at 59.6%.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. estimate_property_value v3 — canonical full rewrite (v2 + the L1 changes).
-- ---------------------------------------------------------------------------

create or replace function public.estimate_property_value(p_property_id uuid, p_exclude_comp_ids uuid[] default null::uuid[])
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_subj record; v_excl uuid[]; v_result jsonb;
  v_beta_lease numeric; v_beta_sale numeric; v_beta_land numeric;
  v_params jsonb; v_class jsonb;
  v_w_ask numeric; v_w_exe numeric;
  v_disc numeric; v_disc_k numeric; v_disc_min numeric; v_disc_max numeric;
  v_typ_cov numeric; v_excess_val numeric; v_land_n int;
  v_rent_acre numeric; v_rent_src text;
  v_usable numeric; v_footprint numeric; v_excess numeric; v_min_excess numeric;
  v_land_measured boolean;
  v_exc_med numeric; v_exc_beta numeric; v_fmin numeric; v_fmax numeric;
  v_sale_factor numeric; v_rent_factor numeric;
  v_sale_rate numeric; v_rent_rate numeric;
  v_rent_acres numeric; v_rent_cap numeric;
  v_ls_min numeric; v_ls_max numeric; v_conc_cap numeric;
  v_subj_eff numeric; v_land_basis text; v_yard_acres numeric;
begin
  select p.id,p.address,p.city,p.state,p.zip,p.county,p.lat,p.lng,
         p.property_type::text as property_type,p.year_built,p.land_acres,p.usable_acres,
         p.net_usable_acres, p.usable_acres_source, p.just_value,p.assessed_value,
         p.land_just_value, p.land_value_share,
         p.zoning_code, p.zoning_description,
         case when p.building_class in ('A','B','C') then p.building_class end as building_class,
         coalesce(p.gross_sf,p.heated_sf)::numeric as subj_sf
    into v_subj from properties p where p.id = p_property_id;
  if not found then return null; end if;

  v_excl := coalesce(p_exclude_comp_ids,
    (select coalesce(array_agg(comp_id),'{}'::uuid[]) from valuation_comp_exclusions where property_id=p_property_id));

  select coalesce(max(beta) filter (where ptype=v_subj.property_type and bucket='lease'),-0.15),
         coalesce(max(beta) filter (where ptype=v_subj.property_type and bucket='sale'),-0.15),
         coalesce(max(beta) filter (where ptype='land' and bucket='sale'),-0.15)
    into v_beta_lease,v_beta_sale,v_beta_land from v_comp_size_elasticity;
  v_beta_land := coalesce(v_beta_land, -0.15);

  select jsonb_object_agg(key,value) into v_params from valuation_params;
  select coalesce(jsonb_object_agg(bucket||'|'||building_class,factor),'{}'::jsonb)
    into v_class from v_comp_class_premium where ptype=v_subj.property_type;

  v_w_ask:=coalesce((v_params->>'weight_asking')::numeric,1.00);
  v_w_exe:=coalesce((v_params->>'weight_executed')::numeric,0.85);
  v_disc:=coalesce((v_params->>'asking_discount_pct')::numeric,5.00);
  v_disc_k:=coalesce((v_params->>'asking_overprice_k')::numeric,2.00);
  v_disc_min:=coalesce((v_params->>'asking_discount_min_pct')::numeric,0.00);
  v_disc_max:=coalesce((v_params->>'asking_discount_max_pct')::numeric,20.00);
  v_min_excess:=coalesce((v_params->>'land_min_excess_acres')::numeric,0.25);
  v_fmin:=coalesce((v_params->>'land_excess_factor_min')::numeric,0.03);
  v_fmax:=coalesce((v_params->>'land_excess_factor_max')::numeric,2.0);
  v_rent_cap:=coalesce((v_params->>'land_rent_max_acres')::numeric,20.0);
  v_ls_min:=coalesce((v_params->>'land_size_adj_min')::numeric,0.35);
  v_ls_max:=coalesce((v_params->>'land_size_adj_max')::numeric,2.50);
  v_conc_cap:=coalesce((v_params->>'land_conc_cap_pct')::numeric,35);

  select m.typ_coverage,m.excess_acre_value,m.n_excess into v_typ_cov,v_excess_val,v_land_n
    from v_county_land_metrics m where m.county=v_subj.county;
  v_land_measured := v_excess_val is not null;
  if v_typ_cov is null or v_typ_cov<=0 then
    v_typ_cov:=coalesce((v_params->>'land_typ_coverage_default')::numeric,0.22); end if;
  if v_excess_val is null then
    select round(s.land_median_per_acre*coalesce((v_params->>'land_excess_fallback_pct')::numeric,0.35),0)
      into v_excess_val from v_county_market_stats s
     where s.county=v_subj.county and s.property_type is null; end if;

  select d.med_excess_acres, d.beta into v_exc_med, v_exc_beta from v_excess_land_decay d;
  v_exc_med := coalesce(v_exc_med, 1.0); v_exc_beta := coalesce(v_exc_beta, -0.5);

  select r.rent_per_acre_month,r.source into v_rent_acre,v_rent_src
    from county_land_rents r where r.county=v_subj.county and r.state=coalesce(v_subj.state,'FL');
  if v_rent_acre is null then
    v_rent_acre:=coalesce((v_params->>'land_default_rent_per_acre_month')::numeric,4500);
    v_rent_src:='default'; end if;

  v_usable := coalesce(v_subj.usable_acres, v_subj.land_acres);
  v_footprint := case when coalesce(v_subj.subj_sf,0)>0 then v_subj.subj_sf/43560 else 0 end;
  v_excess := greatest(0, coalesce(v_usable,0) - v_footprint);
  if coalesce(v_subj.subj_sf,0)<=0 or v_subj.property_type='land' or v_excess<v_min_excess then
    v_excess:=0; end if;

  -- L1: a land subject is priced on USABLE acres (comps compute their rate on their
  -- own usable acres below, so rate × usable is consistent end to end). Below 0.05
  -- usable acres fall back to gross — a bad polygon must not zero a parcel.
  v_subj_eff := case when coalesce(v_subj.usable_acres,0) > 0.05 then v_subj.usable_acres
                     else v_subj.land_acres end;
  v_land_basis := case when coalesce(v_subj.usable_acres,0) > 0.05 then 'usable' else 'gross' end;

  -- Vacant subjects let their usable ground as yard (same cap and decay the improved
  -- path uses); improved subjects rent excess-beyond-footprint exactly as before.
  if v_subj.property_type='land' or coalesce(v_subj.subj_sf,0)<=0 then
    v_yard_acres := coalesce(v_subj_eff, 0);
  else
    v_yard_acres := v_excess;
  end if;
  v_rent_acres := least(v_yard_acres, v_rent_cap);
  v_sale_factor := apply_land_decay(v_excess, v_exc_med, v_exc_beta, v_fmin, v_fmax);
  v_rent_factor := apply_land_decay(v_rent_acres,
                     coalesce((v_params->>'land_rent_typical_acres')::numeric,5.0),
                     coalesce((v_params->>'land_rent_decay_beta')::numeric,-0.25), v_fmin, v_fmax);
  v_sale_rate := round(coalesce(v_excess_val,0) * v_sale_factor, 0);
  v_rent_rate := round(v_rent_acre * v_rent_factor, 0);

  with raw as (
    select c.id as comp_id,c.property_id,cp.address,cp.city,cp.county,
           cp.property_type::text as property_type,
           case when cp.building_class in ('A','B','C') then cp.building_class end as building_class,
           c.kind::text as kind,c.verified,c.tenant_name,c.lease_structure::text as lease_structure,
           c.term_months,c.opex_psf,c.cap_rate_pct,c.sale_price,
           c.source_key,c.deal_type::text as deal_type,c.sale_type,
           c.days_on_market,c.listed_at,c.occupancy,
           (cp.listing_status='on_market') as listing_active,
           cp.land_value_share as comp_land_share,
           coalesce(c.executed_at,c.as_of_date,c.created_at::date) as comp_date,
           coalesce(c.sf,cp.gross_sf)::numeric as comp_sf,
           coalesce(c.land_acres,cp.land_acres) as comp_acres,
           -- The comp property's usable FRACTION, applied to the comp's own acres:
           -- comp acres and property acres can differ (assemblages, partial sales).
           case when cp.land_acres > 0 and cp.usable_acres is not null
                then greatest(0::numeric, least(1::numeric, cp.usable_acres/cp.land_acres))
                else 1 end as comp_usable_frac,
           coalesce(c.sale_price, c.price_per_acre*coalesce(c.land_acres,cp.land_acres)) as comp_price,
           coalesce(c.executed_lease_rate_psf,c.asking_lease_rate_psf) as lease_psf,
           coalesce(c.price_per_sf,c.sale_price/nullif(coalesce(c.sf,cp.gross_sf),0)) as sale_psf,
           case when v_subj.lat is null or v_subj.lng is null or cp.lat is null or cp.lng is null then null
                else 3958.8*2*asin(sqrt(power(sin(radians(cp.lat-v_subj.lat)/2),2)
                     +cos(radians(v_subj.lat))*cos(radians(cp.lat))*power(sin(radians(cp.lng-v_subj.lng)/2),2)))
           end::numeric as miles
      from comps c join properties cp on cp.id=c.property_id
     where c.property_id<>v_subj.id
       and c.kind in ('asking'::comp_kind,'executed'::comp_kind)
       and coalesce(c.executed_at,c.as_of_date,c.created_at::date) >= current_date - interval '6 years'),
  fenced as (select * from raw where (miles is not null and miles<=25)
        or (miles is null and county is not distinct from v_subj.county and v_subj.county is not null)),
  eff as (select f.*,
           case when f.comp_acres * f.comp_usable_frac > 0.05
                then round(f.comp_acres * f.comp_usable_frac, 4)
                else f.comp_acres end as comp_eff_acres
      from fenced f),
  bucketed as (select f.*,b.bucket,
           case b.bucket when 'lease' then f.lease_psf when 'sale' then f.sale_psf
                else f.comp_price/nullif(f.comp_eff_acres,0) end as metric
      from eff f cross join (values ('lease'),('sale'),('land')) as b(bucket)
     where case b.bucket
             when 'lease' then f.lease_psf between 1 and 100 and f.comp_sf>300
                               and f.property_type is distinct from 'land' and coalesce(v_subj.subj_sf,0)>0
             when 'sale' then f.sale_psf between 5 and 900 and f.comp_sf>300
                               and f.property_type is distinct from 'land' and coalesce(v_subj.subj_sf,0)>0
             else f.comp_price/nullif(f.comp_eff_acres,0) between 5000 and 5000000
                  and f.comp_acres>0.05 and f.property_type='land'
                  and (v_subj.property_type='land' or coalesce(v_subj.subj_sf,0)<=0) end),
  scored as (select b.*,coalesce(1/(1+power(coalesce(b.miles,8)/3.0,2)),0.1) as w_dist,
           case when b.bucket='land' then
                  case when coalesce(v_subj_eff,0)>0 and b.comp_eff_acres>0
                       then exp(-power(ln(b.comp_eff_acres/v_subj_eff),2)/(2*power(0.6,2))) else 0.5 end
                else case when v_subj.subj_sf>0 and b.comp_sf>0
                       then exp(-power(ln(b.comp_sf/v_subj.subj_sf),2)/(2*power(0.7,2))) else 0.5 end
           end::numeric as w_size,
           power(0.5,(current_date-b.comp_date)::numeric/365.25/3.0)::numeric as w_time,
           case when b.kind='executed' then v_w_exe else v_w_ask end as w_kind,
           case when b.verified then 1.0 else 0.9 end::numeric as w_verified,
           case when v_subj.property_type is null or b.property_type is null then 0.7
                when b.property_type=v_subj.property_type then 1.0 else 0.35 end::numeric as w_type,
           case b.bucket when 'lease' then v_beta_lease when 'sale' then v_beta_sale else v_beta_land end as beta
      from bucketed b),
  adjusted as (select s.*,(s.w_dist*s.w_size*s.w_time*s.w_kind*s.w_verified*s.w_type)::numeric as weight,
           case when s.bucket='land' then
                  -- Measured beta ≈ -0.5, so land needs wider clamps than buildings:
                  -- at [0.6,1.6] any size ratio past ~2.8x would truncate. The σ=0.6
                  -- kernel has already stripped weight from dissimilar sizes.
                  least(v_ls_max,greatest(v_ls_min,case when coalesce(v_subj_eff,0)>0 and s.comp_eff_acres>0
                       then power(v_subj_eff/s.comp_eff_acres,s.beta) else 1 end))
                -- Tighter than it was: at [0.6,1.6] a 7,566 SF comp was being restated
                -- 60% higher for a 2,400 SF subject and carried real weight.
                else least(1.4,greatest(0.75,case when v_subj.subj_sf>0 and s.comp_sf>0
                       then power(v_subj.subj_sf/s.comp_sf,s.beta) else 1 end)) end::numeric as size_adj,
           case when v_subj.building_class is null or s.building_class is null or s.bucket='land' then 1.0
                when v_subj.building_class=s.building_class then 1.0
                else least(1.35,greatest(0.75,
                       coalesce((v_class->>(s.bucket||'|'||v_subj.building_class))::numeric,
                                (v_params->>('class_factor_'||lower(v_subj.building_class)))::numeric,1.0)
                     / nullif(coalesce((v_class->>(s.bucket||'|'||s.building_class))::numeric,
                                (v_params->>('class_factor_'||lower(s.building_class)))::numeric,1.0),0)))
           end::numeric as class_adj
      from scored s),
  deduped as (select * from (select a.*,row_number() over (partition by a.bucket,a.property_id
        order by a.weight desc,a.comp_date desc) as prn from adjusted a where a.weight>=0.01) q where prn=1),
  pre as (select d.*,round(d.metric*d.size_adj*d.class_adj,case when d.bucket='land' then 0 else 2 end) as adj_pre from deduped d),
  peers as (select bucket,percentile_cont(0.5) within group (order by (adj_pre::double precision))::numeric as peer_med from pre group by bucket),
  discounted as (select p.*,pr.peer_med,
           case when p.kind='executed' then 0::numeric
                else least(v_disc_max,greatest(v_disc_min,v_disc*(1+v_disc_k*
                     case when pr.peer_med>0 then (p.adj_pre/pr.peer_med)-1 else 0 end))) end as discount_pct
      from pre p join peers pr on pr.bucket=p.bucket),
  ranked as (select d.*,round(d.adj_pre*(1-d.discount_pct/100),case when d.bucket='land' then 0 else 2 end) as adj_metric,
           not (d.comp_id=any(v_excl)) as included,
           row_number() over (partition by d.bucket order by d.weight desc) as rn,
           -- display rank: the tabbed sheet wants depth per (bucket, kind), not just the
           -- blended top of the bucket
           row_number() over (partition by d.bucket,d.kind order by d.weight desc) as krn from discounted d),
  top_comps as (select * from ranked where rn<=30 or krn<=20),
  -- ESTIMATE SET: rn<=30 exactly as v1 — krn-only rows are display extras and must never
  -- feed stats, weights, or the peers that were computed above (peers reads pre, upstream).
  used as (select * from top_comps where included and rn<=30),
  stats as (select u.bucket,count(*) as n,
           weighted_percentile(array_agg(u.adj_metric),array_agg(u.weight),0.50) as p50,
           weighted_percentile(array_agg(u.adj_metric),array_agg(u.weight),0.25) as p25,
           weighted_percentile(array_agg(u.adj_metric),array_agg(u.weight),0.75) as p75,
           round(avg(u.cap_rate_pct),2) as avg_cap,round(avg(u.miles),1) as avg_miles,
           count(*) filter (where u.kind='executed') as n_executed,
           round(avg(u.discount_pct) filter (where u.kind='asking'),1) as avg_asking_discount,
           count(*) filter (where u.class_adj<>1.0) as n_class_adjusted,
           max(u.weight) as w_max, sum(u.weight) as w_sum
      from used u group by u.bucket),
  tax as (select coalesce(t.millage,18.0) as millage,coalesce(t.source,'fl_default') as source,t.effective_year,
           coalesce(t.notes,'No rate on file for this county - using an 18 mill Florida default') as notes
      from (select 1) x left join county_tax_rates t on t.county=v_subj.county and t.state=coalesce(v_subj.state,'FL')),
  land_add as (select case when v_excess>0 and v_sale_rate>0 then round(v_excess*v_sale_rate,-3) else 0 end as sale_land,
                      case when v_rent_acres>0 then round(v_rent_acres*v_rent_rate,0) else 0 end as rent_land),
  -- County transfer sales: display-only evidence for the Sold tab. A separate chain so it
  -- cannot move peers/stats/used — the estimate has never included transfers (kind guard)
  -- and still doesn't. Weight here orders the list, nothing else.
  t_raw as (
    select c.id as comp_id,c.property_id,cp.address,cp.city,cp.county,
           cp.property_type::text as property_type,
           case when cp.building_class in ('A','B','C') then cp.building_class end as building_class,
           c.sale_price,c.source_key,c.sale_type,
           cp.land_value_share as comp_land_share,
           coalesce(c.executed_at,c.as_of_date,c.created_at::date) as comp_date,
           coalesce(c.sf,cp.gross_sf)::numeric as comp_sf,
           coalesce(c.land_acres,cp.land_acres) as comp_acres,
           case when v_subj.lat is null or v_subj.lng is null or cp.lat is null or cp.lng is null then null
                else 3958.8*2*asin(sqrt(power(sin(radians(cp.lat-v_subj.lat)/2),2)
                     +cos(radians(v_subj.lat))*cos(radians(cp.lat))*power(sin(radians(cp.lng-v_subj.lng)/2),2)))
           end::numeric as miles
      from comps c join properties cp on cp.id=c.property_id
     where c.property_id<>v_subj.id
       and c.kind='transfer'::comp_kind
       and c.sale_price>=10000
       and coalesce(c.executed_at,c.as_of_date,c.created_at::date) >= current_date - interval '6 years'),
  t_fenced as (select * from t_raw where (miles is not null and miles<=25)
        or (miles is null and county is not distinct from v_subj.county and v_subj.county is not null)),
  t_scored as (select t.*,
           (coalesce(1/(1+power(coalesce(t.miles,8)/3.0,2)),0.1)
            * case when v_subj.subj_sf>0 and t.comp_sf>0
                   then exp(-power(ln(t.comp_sf/v_subj.subj_sf),2)/(2*power(0.7,2)))
                   when coalesce(v_subj.subj_sf,0)<=0 and v_subj.land_acres>0 and t.comp_acres>0
                   then exp(-power(ln(t.comp_acres/v_subj.land_acres),2)/(2*power(0.6,2)))
                   else 0.5 end
            * power(0.5,(current_date-t.comp_date)::numeric/365.25/3.0))::numeric as t_weight,
           row_number() over (partition by t.property_id order by t.comp_date desc) as t_prop_rn
      from t_fenced t),
  t_top as (select * from (select ts.*,row_number() over (order by ts.t_weight desc) as t_rn
      from t_scored ts where ts.t_prop_rn<=2) q where t_rn<=20)
  select jsonb_build_object(
    'property_id',v_subj.id,'as_of',current_date,
    'subject',jsonb_build_object('address',v_subj.address,'county',v_subj.county,
      'property_type',v_subj.property_type,'building_class',v_subj.building_class,'sf',v_subj.subj_sf,
      'land_acres',v_subj.land_acres,'usable_acres',v_subj.usable_acres,
      'net_usable_acres',v_subj.net_usable_acres,'year_built',v_subj.year_built,
      'just_value',v_subj.just_value,'assessed_value',v_subj.assessed_value,
      'land_just_value',v_subj.land_just_value,'land_value_share',v_subj.land_value_share,
      'zoning_code',v_subj.zoning_code,'zoning_description',v_subj.zoning_description),
    'method',jsonb_build_object('asking_discount_pct',v_disc,'asking_overprice_k',v_disc_k,
      'weight_asking',v_w_ask,'weight_executed',v_w_exe,
      'class_ladder_measured',v_class<>'{}'::jsonb,'class_factors',v_class),
    'land_component',jsonb_build_object('acres_total',v_subj.land_acres,'acres_usable',v_usable,
      'usable_is_estimated',v_subj.usable_acres is null,
      'usable_source',v_subj.usable_acres_source,
      'footprint_acres',round(v_footprint,2),
      'typ_coverage',round(v_typ_cov,4),
      'supported_acres',round(v_footprint,2),'excess_acres',round(v_excess,2),
      'base_acre_value',v_excess_val,'size_factor',round(v_sale_factor,3),
      'excess_acre_value',v_sale_rate,'excess_value_measured',v_land_measured,
      'rentable_acres',round(v_rent_acres,2),'rent_capped',v_yard_acres > v_rent_acres,
      'base_rent_per_acre_month',v_rent_acre,'rent_size_factor',round(v_rent_factor,3),
      'rent_per_acre_month',v_rent_rate,'rent_source',v_rent_src,
      'sale_contribution',(select sale_land from land_add),
      'rent_contribution_monthly',(select rent_land from land_add)),
    'sale',(select case when s.p50 is null then null else jsonb_build_object(
        'psf',s.p50,'psf_low',s.p25,'psf_high',s.p75,
        'building_total',case when v_subj.subj_sf>0 then round(s.p50*v_subj.subj_sf,-3) end,
        'land_total',(select sale_land from land_add),
        'total',case when v_subj.subj_sf>0 then round(s.p50*v_subj.subj_sf,-3)+(select sale_land from land_add) end,
        'total_low',case when v_subj.subj_sf>0 then round(s.p25*v_subj.subj_sf,-3)+(select sale_land from land_add) end,
        'total_high',case when v_subj.subj_sf>0 then round(s.p75*v_subj.subj_sf,-3)+(select sale_land from land_add) end,
        'cap_rate',s.avg_cap,'n',s.n,'n_executed',s.n_executed,'avg_miles',s.avg_miles,
        'avg_asking_discount',s.avg_asking_discount,'n_class_adjusted',s.n_class_adjusted,
        'confidence',case when s.n>=8 and s.p50>0 and (s.p75-s.p25)/s.p50<=0.45 then 'high'
                          when s.n>=4 then 'medium' else 'low' end) end
      from stats s where s.bucket='sale'),
    'lease',(select case when s.p50 is null then null else jsonb_build_object(
        'psf',s.p50,'psf_low',s.p25,'psf_high',s.p75,
        'building_monthly',case when v_subj.subj_sf>0 then round(s.p50*v_subj.subj_sf/12,0) end,
        'land_monthly',(select rent_land from land_add),
        'monthly',case when v_subj.subj_sf>0 then round(s.p50*v_subj.subj_sf/12,0)+(select rent_land from land_add) end,
        'monthly_low',case when v_subj.subj_sf>0 then round(s.p25*v_subj.subj_sf/12,0)+(select rent_land from land_add) end,
        'monthly_high',case when v_subj.subj_sf>0 then round(s.p75*v_subj.subj_sf/12,0)+(select rent_land from land_add) end,
        'annual',case when v_subj.subj_sf>0 then round(s.p50*v_subj.subj_sf,0)+(select rent_land from land_add)*12 end,
        'n',s.n,'n_executed',s.n_executed,'avg_miles',s.avg_miles,
        'avg_asking_discount',s.avg_asking_discount,'n_class_adjusted',s.n_class_adjusted,
        'confidence',case when s.n>=8 and s.p50>0 and (s.p75-s.p25)/s.p50<=0.45 then 'high'
                          when s.n>=4 then 'medium' else 'low' end) end
      from stats s where s.bucket='lease'),
    'land',(select case when s.p50 is null or coalesce(v_subj_eff,0)<=0 then null else jsonb_build_object(
        'per_acre',s.p50,'per_acre_low',s.p25,'per_acre_high',s.p75,
        'total',round(s.p50*v_subj_eff,-3),'total_low',round(s.p25*v_subj_eff,-3),
        'total_high',round(s.p75*v_subj_eff,-3),
        'basis_acres',round(v_subj_eff,2),'acres_basis',v_land_basis,
        'size_beta',v_beta_land,
        'asking_only',s.n_executed=0,
        'top_weight_pct',case when s.w_sum>0 then round(s.w_max/s.w_sum*100,1) end,
        'rent_monthly',(select rent_land from land_add),
        'rent_per_acre_month',v_rent_rate,'rent_source',v_rent_src,
        'rentable_acres',round(v_rent_acres,2),'rent_capped',v_yard_acres > v_rent_acres,
        'n',s.n,'n_executed',s.n_executed,'avg_miles',s.avg_miles,
        'avg_asking_discount',s.avg_asking_discount,'n_class_adjusted',s.n_class_adjusted,
        -- Honest confidence: no executed evidence, or one comp dominating, caps the
        -- label — the value can be right, but "high" must mean corroborated.
        'confidence',case
            when s.n>=8 and s.p50>0 and (s.p75-s.p25)/s.p50<=0.45
                 and s.n_executed>0 and (s.w_sum<=0 or s.w_max/s.w_sum*100<=v_conc_cap) then 'high'
            when s.n>=4 and not (s.n_executed=0 and s.w_sum>0 and s.w_max/s.w_sum*100>50) then 'medium'
            else 'low' end) end
      from stats s where s.bucket='land'),
    'tax',(select jsonb_build_object('county',v_subj.county,'millage',t.millage,
        'rate_pct',round(t.millage/10.0,3),'source',t.source,'effective_year',t.effective_year,'notes',t.notes,
        'basis',(select case when (v_subj.property_type='land' or coalesce(v_subj.subj_sf,0)<=0) and coalesce(v_subj_eff,0)>0
              then (select round(s.p50*v_subj_eff,-3) from stats s where s.bucket='land')
            when v_subj.subj_sf>0 then (select round(s.p50*v_subj.subj_sf,-3) from stats s where s.bucket='sale')
                 +(select sale_land from land_add) end),
        'assessed_value',v_subj.assessed_value,
        'current_annual',case when v_subj.assessed_value>0 then round(v_subj.assessed_value*t.millage/1000.0,0) end)
      from tax t),
    'comps',coalesce((select jsonb_agg(jsonb_build_object(
        'comp_id',tc.comp_id,'property_id',tc.property_id,'address',tc.address,'city',tc.city,'county',tc.county,
        'property_type',tc.property_type,'building_class',tc.building_class,'bucket',tc.bucket,'kind',tc.kind,
        'verified',tc.verified,'tenant_name',tc.tenant_name,'lease_structure',tc.lease_structure,
        'term_months',tc.term_months,'opex_psf',tc.opex_psf,'cap_rate_pct',tc.cap_rate_pct,
        'sale_price',tc.sale_price,'comp_date',tc.comp_date,'sf',tc.comp_sf,'acres',tc.comp_acres,
        'eff_acres',round(tc.comp_eff_acres,2),
        'acres_basis',case when tc.comp_eff_acres<>tc.comp_acres then 'usable' else 'gross' end,
        'miles',round(tc.miles,1),'metric',round(tc.metric,case when tc.bucket='land' then 0 else 2 end),
        'adj_pre',tc.adj_pre,'adj_metric',tc.adj_metric,'size_adj',round(tc.size_adj,3),
        'class_adj',round(tc.class_adj,3),'discount_pct',round(tc.discount_pct,1),'weight',round(tc.weight,4),
        'weight_pct',case when wt.total>0 and tc.included and tc.rn<=30 then round(tc.weight/wt.total*100,1) else 0 end,
        'included',tc.included,
        'in_estimate',tc.rn<=30,
        'source_key',tc.source_key,'deal_type',tc.deal_type,'sale_type',tc.sale_type,
        'days_on_market',tc.days_on_market,'listed_at',tc.listed_at,'occupancy',tc.occupancy,
        'listing_active',tc.listing_active,
        'county_land_share',tc.comp_land_share,
        'land_alloc',case when tc.bucket in ('sale','land') and tc.sale_price>0 and tc.comp_land_share is not null
                          then round(tc.sale_price*tc.comp_land_share,0) end,
        'building_alloc',case when tc.bucket in ('sale','land') and tc.sale_price>0 and tc.comp_land_share is not null
                          then round(tc.sale_price*(1-tc.comp_land_share),0) end,
        'building_psf_alloc',case when tc.bucket in ('sale','land') and tc.sale_price>0 and tc.comp_land_share is not null
                          and tc.comp_sf>0 then round(tc.sale_price*(1-tc.comp_land_share)/tc.comp_sf,2) end,
        'land_per_acre_alloc',case when tc.bucket in ('sale','land') and tc.sale_price>0 and tc.comp_land_share is not null
                          and tc.comp_acres>0 then round(tc.sale_price*tc.comp_land_share/tc.comp_acres,0) end
        ) order by tc.bucket,tc.weight desc)
      from top_comps tc left join (select bucket,sum(weight) as total from used group by bucket) wt on wt.bucket=tc.bucket
    ),'[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object(
        'comp_id',tt.comp_id,'property_id',tt.property_id,'address',tt.address,'city',tt.city,'county',tt.county,
        'property_type',tt.property_type,'building_class',tt.building_class,
        'bucket',case when tt.property_type='land' or coalesce(tt.comp_sf,0)<=0 then 'land' else 'sale' end,
        'kind','transfer',
        'verified',null::boolean,'tenant_name',null::text,'lease_structure',null::text,
        'term_months',null::int,'opex_psf',null::numeric,'cap_rate_pct',null::numeric,
        'sale_price',tt.sale_price,'comp_date',tt.comp_date,'sf',tt.comp_sf,'acres',tt.comp_acres,
        'miles',round(tt.miles,1),
        'metric',case when tt.property_type='land' or coalesce(tt.comp_sf,0)<=0
                      then round(tt.sale_price/nullif(tt.comp_acres,0),0)
                      else round(tt.sale_price/nullif(tt.comp_sf,0),2) end,
        'adj_pre',null::numeric,'adj_metric',null::numeric,'size_adj',null::numeric,
        'class_adj',null::numeric,'discount_pct',null::numeric,
        'weight',null::numeric,'weight_pct',0,'included',not (tt.comp_id=any(v_excl)),
        'in_estimate',false,
        'source_key',tt.source_key,'deal_type','sale','sale_type',tt.sale_type,
        'days_on_market',null::int,'listed_at',null::date,'occupancy',null::text,'listing_active',null::boolean,
        'county_land_share',tt.comp_land_share,
        'land_alloc',case when tt.sale_price>0 and tt.comp_land_share is not null
                          then round(tt.sale_price*tt.comp_land_share,0) end,
        'building_alloc',case when tt.sale_price>0 and tt.comp_land_share is not null
                          then round(tt.sale_price*(1-tt.comp_land_share),0) end,
        'building_psf_alloc',case when tt.sale_price>0 and tt.comp_land_share is not null
                          and tt.comp_sf>0 then round(tt.sale_price*(1-tt.comp_land_share)/tt.comp_sf,2) end,
        'land_per_acre_alloc',case when tt.sale_price>0 and tt.comp_land_share is not null
                          and tt.comp_acres>0 then round(tt.sale_price*tt.comp_land_share/tt.comp_acres,0) end
        ) order by tt.t_rn)
      from t_top tt
    ),'[]'::jsonb),
    'excluded_comp_ids',to_jsonb(v_excl)
  ) into v_result;
  return v_result;
end $function$;

grant execute on function estimate_property_value(uuid, uuid[]) to authenticated, anon;
