-- Valuation, third pass: the land is not free.
--
-- 4724 Ashton Rd is a 5,000 SF building on 4.83 acres - 2.4% coverage. Valued on
-- building $/SF alone it came out around $1.0M; the county's own just value is
-- $1,846,800. The land was most of the property and the estimate ignored it.
-- **5,178 of the 12,657 properties that have both figures sit under 15% coverage**,
-- so this is the common case, not an edge case.
--
-- The fix is the appraiser's excess-land treatment: a comp's $/SF already includes
-- a TYPICAL site, so only land BEYOND that typical site is added. Anything else
-- double-counts - the $200/SF comp is sitting on its own dirt too.
--
--   value  = building $/SF x SF  +  excess acres x $/excess acre
--   rent   = building $/SF x SF / 12  +  excess acres x $/acre/month
--
-- WHERE THE TWO LAND RATES COME FROM, and why they differ:
--
--  * SALE ($/excess acre) is MEASURED off our own comps (Alex asked for the data
--    to decide rather than a guessed discount). First attempt was a two-variable
--    OLS of price on (SF, acres); it collapsed - building SF and lot size are too
--    collinear, and it returned $7/SF buildings in Hillsborough. What works is a
--    one-parameter robust fit: anchor the building rate on the county median $/SF,
--    then take the MEDIAN residual per excess acre. Anchors come back at $155-252
--    /SF, which is the sanity check that the method holds.
--  * LEASE ($/acre/month) is NOT measurable here - our lease comps are building
--    rates, and IOS yard rent never appears in them. These are Alex's market
--    numbers (Sarasota 6-8k, Tampa 5-7k, Lakeland 2.5-4k), stored editable.
--
-- USABLE vs TOTAL ACRES: the engine reads `coalesce(usable_acres, land_acres)`.
-- `usable_acres` is currently populated on ZERO of 17,364 properties, so every
-- estimate today uses total acreage and therefore OVERSTATES a wet parcel. The
-- moment uplands acreage is filled in, every estimate sharpens with no code change.

-- ---------------------------------------------------------------------------
-- 1. IOS yard rent per county. Judgement, so it is a table, not a measurement.
-- ---------------------------------------------------------------------------
create table if not exists county_land_rents (
  county text not null,
  state text not null default 'FL',
  rent_per_acre_month numeric(12,2) not null check (rent_per_acre_month > 0),
  source text not null default 'broker_estimate',
  notes text,
  updated_at timestamptz not null default now(),
  primary key (county, state)
);

alter table county_land_rents enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'county_land_rents' and policyname = 'county_land_rents_auth_all') then
    create policy county_land_rents_auth_all on county_land_rents for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'county_land_rents' and policyname = 'county_land_rents_anon_read') then
    create policy county_land_rents_anon_read on county_land_rents for select to anon using (true);
  end if;
end $$;

drop trigger if exists county_land_rents_updated_at on county_land_rents;
create trigger county_land_rents_updated_at before update on county_land_rents
  for each row execute function set_updated_at();

-- Only the three marked 'alex' came from Alex. The rest are interpolated from
-- those against neighbouring market strength and are flagged so, so nobody
-- mistakes a guess for a quote.
insert into county_land_rents (county, state, rent_per_acre_month, source, notes) values
  ('Sarasota','FL',     7000, 'alex',      'Alex: Sarasota runs $6-8k/acre/month'),
  ('Hillsborough','FL', 6000, 'alex',      'Alex: Tampa runs $5-7k/acre/month'),
  ('Polk','FL',         3250, 'alex',      'Alex: Lakeland runs $2.5-4k/acre/month'),
  ('Manatee','FL',      6000, 'interpolated','Between Sarasota and Hillsborough - CONFIRM'),
  ('Pinellas','FL',     6500, 'interpolated','Tightest supply in the bay - CONFIRM'),
  ('Pasco','FL',        4500, 'interpolated','Between Tampa and Lakeland - CONFIRM'),
  ('Hernando','FL',     3500, 'interpolated','CONFIRM'),
  ('Lee','FL',          5500, 'interpolated','CONFIRM'),
  ('Charlotte','FL',    4000, 'interpolated','CONFIRM'),
  ('Collier','FL',      6000, 'interpolated','CONFIRM'),
  ('Orange','FL',       5500, 'interpolated','CONFIRM'),
  ('Osceola','FL',      4500, 'interpolated','CONFIRM'),
  ('Lake','FL',         3500, 'interpolated','CONFIRM'),
  ('Seminole','FL',     5500, 'interpolated','CONFIRM')
on conflict (county, state) do nothing;

insert into valuation_params (key, value, notes) values
  ('land_default_rent_per_acre_month', 4500, 'Yard rent for a county with no rate on file.'),
  ('land_excess_fallback_pct',          0.35, 'Share of the county land-comp median $/acre used when the excess-land fit is not available.'),
  ('land_min_excess_acres',             0.25, 'Below this, excess land is noise - a wide driveway, not a yard.'),
  ('land_typ_coverage_default',         0.22, 'Site coverage assumed when a county has too few sales to measure one.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The measured half: typical site coverage, and what an excess acre adds.
-- ---------------------------------------------------------------------------
create or replace view v_county_land_metrics as
with sales as (
  select p.county,
         c.sale_price::numeric as y,
         coalesce(c.sf, p.gross_sf)::numeric as sf,
         coalesce(c.land_acres, p.land_acres)::numeric as ac
  from comps c
  join properties p on p.id = c.property_id
  where c.sale_price between 50000 and 60000000
    and coalesce(c.executed_at, c.as_of_date, c.created_at::date) >= current_date - interval '6 years'
    and coalesce(c.sf, p.gross_sf) > 500
    and coalesce(c.land_acres, p.land_acres) between 0.05 and 100
),
cov as (
  select *, sf / (ac * 43560) as coverage, y / sf as psf
  from sales where y / sf between 20 and 900
),
par as (
  select county, count(*) as n,
         percentile_cont(0.5) within group (order by (coverage::double precision))::numeric as typ_coverage,
         percentile_cont(0.5) within group (order by (psf::double precision))::numeric as med_psf
  from cov group by county having count(*) >= 40
),
resid as (
  select c.county,
         (c.y - p.med_psf * c.sf) / nullif(c.ac - c.sf / p.typ_coverage / 43560, 0) as per_excess_acre
  from cov c
  join par p on p.county = c.county
  where c.ac - c.sf / p.typ_coverage / 43560 > 0.15
)
select p.county,
       p.n,
       round(p.typ_coverage, 4) as typ_coverage,
       round(p.med_psf, 2) as med_psf,
       count(r.*) as n_excess,
       -- Clamped: the residual divides by a small number, so the tails are wild.
       -- The median is the defensible middle; the clamp stops a bad county
       -- from ever producing an absurd land line.
       least(2000000, greatest(10000,
         round(percentile_cont(0.5) within group (order by (r.per_excess_acre::double precision))::numeric, 0)
       )) as excess_acre_value
from par p
left join resid r on r.county = p.county
group by p.county, p.n, p.typ_coverage, p.med_psf
having count(r.*) >= 15
   and percentile_cont(0.5) within group (order by (r.per_excess_acre::double precision)) > 0;

comment on view v_county_land_metrics is
  'Per county: median site coverage of improved sales, and the MEDIAN residual value of an acre beyond that typical site. A two-variable OLS on (SF, acres) was tried first and collapsed on collinearity - see the migration header. Feeds the land component of estimate_property_value.';

-- ---------------------------------------------------------------------------
-- 3. Size decay. The excess-acre rate above is measured at a ~1 acre excess and
--    does NOT extrapolate: pricing a 182-acre back field off it produced an
--    estimate 20x the county's own just value. Measured beta ~ -0.73 (r -0.61,
--    n=343) statewide - per-county n is far too thin for a second regression.
-- ---------------------------------------------------------------------------
insert into valuation_params (key, value, notes) values
  ('land_rent_typical_acres', 5.0, 'Yard size Alex''s $/acre/month quote is taken to describe.'),
  ('land_rent_decay_beta', -0.25, 'Gentler than the sale decay and NOT measured (no land-rent comps). Set to 0 for a flat per-acre rent.'),
  ('land_excess_factor_min', 0.03, 'Floor on the size decay, so a huge parcel still carries some value.'),
  ('land_excess_factor_max', 2.0, 'Ceiling, so a sliver of excess cannot be priced above the market rate.')
on conflict (key) do nothing;

create or replace view v_excess_land_decay as
with sales as (
  select p.county, c.sale_price::numeric y,
         coalesce(c.sf,p.gross_sf)::numeric sf, coalesce(c.land_acres,p.land_acres)::numeric ac
  from comps c join properties p on p.id=c.property_id
  where c.sale_price between 50000 and 60000000
    and coalesce(c.executed_at,c.as_of_date,c.created_at::date) >= current_date - interval '6 years'
    and coalesce(c.sf,p.gross_sf) > 500 and coalesce(c.land_acres,p.land_acres) between 0.05 and 300
),
cov as (select *, sf/(ac*43560) coverage, y/sf psf from sales where y/sf between 20 and 900),
par as (select county, percentile_cont(0.5) within group (order by (coverage::float8))::numeric typ_cov,
               percentile_cont(0.5) within group (order by (psf::float8))::numeric med_psf
        from cov group by county having count(*) >= 40),
r as (select (c.ac - c.sf/p.typ_cov/43560) exc,
             (c.y - p.med_psf*c.sf)/nullif(c.ac - c.sf/p.typ_cov/43560,0) per_acre
      from cov c join par p on p.county=c.county
      where c.ac - c.sf/p.typ_cov/43560 > 0.15)
select count(*) as n,
       round(percentile_cont(0.5) within group (order by (exc::float8))::numeric, 2) as med_excess_acres,
       greatest(-1.0, least(0.0,
         round(regr_slope(ln(per_acre)::float8, ln(exc)::float8)::numeric, 4))) as beta,
       round(corr(ln(per_acre)::float8, ln(exc)::float8)::numeric, 3) as r
from r where per_acre > 1000 and exc > 0.15;

comment on view v_excess_land_decay is
  'How $/excess-acre falls as the excess grows: beta ~ -0.73, r ~ -0.61 (n=343). Without it a 182-acre parcel priced off a 1-acre marginal rate came out 20x the county just value.';

create or replace function apply_land_decay(p_acres numeric, p_typical numeric, p_beta numeric,
                                            p_min numeric, p_max numeric)
returns numeric language sql immutable as $$
  select least(coalesce(p_max,2.0), greatest(coalesce(p_min,0.03),
           case when coalesce(p_acres,0) > 0 and coalesce(p_typical,0) > 0
                then power(p_acres / p_typical, coalesce(p_beta,0))
                else 1 end));
$$;

comment on function apply_land_decay(numeric,numeric,numeric,numeric,numeric) is
  'Size decay for a per-acre land rate: (acres/typical)^beta, clamped. Land value per acre falls sharply with parcel size - see v_excess_land_decay.';

grant execute on function apply_land_decay(numeric,numeric,numeric,numeric,numeric) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4. The engine. Full body lives in the DB; this file is replayed by
--    `supabase db reset`, so it must stay in step. Verified by re-applying this
--    file and re-running the 4724 Ashton Rd fixture.
-- ---------------------------------------------------------------------------
create or replace function estimate_property_value(
  p_property_id uuid, p_exclude_comp_ids uuid[] default null
) returns jsonb
language plpgsql stable security definer set search_path = public
as $fn$
declare
  v_subj record; v_excl uuid[]; v_result jsonb;
  v_beta_lease numeric; v_beta_sale numeric; v_beta_land numeric;
  v_params jsonb; v_class jsonb;
  v_w_ask numeric; v_w_exe numeric;
  v_disc numeric; v_disc_k numeric; v_disc_min numeric; v_disc_max numeric;
  v_typ_cov numeric; v_excess_val numeric; v_land_n int;
  v_rent_acre numeric; v_rent_src text;
  v_usable numeric; v_supported numeric; v_excess numeric; v_min_excess numeric;
  v_land_measured boolean;
  v_exc_med numeric; v_exc_beta numeric; v_fmin numeric; v_fmax numeric;
  v_sale_factor numeric; v_rent_factor numeric;
  v_sale_rate numeric; v_rent_rate numeric;
begin
  select p.id,p.address,p.city,p.state,p.zip,p.county,p.lat,p.lng,
         p.property_type::text as property_type,p.year_built,p.land_acres,p.usable_acres,
         p.just_value,p.assessed_value,
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
  v_supported := case when coalesce(v_subj.subj_sf,0)>0 then v_subj.subj_sf/v_typ_cov/43560 else 0 end;
  v_excess := greatest(0, coalesce(v_usable,0) - v_supported);
  if coalesce(v_subj.subj_sf,0)<=0 or v_subj.property_type='land' or v_excess<v_min_excess then
    v_excess:=0; end if;

  v_sale_factor := apply_land_decay(v_excess, v_exc_med, v_exc_beta, v_fmin, v_fmax);
  v_rent_factor := apply_land_decay(v_excess,
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
           coalesce(c.executed_at,c.as_of_date,c.created_at::date) as comp_date,
           coalesce(c.sf,cp.gross_sf)::numeric as comp_sf,
           coalesce(c.land_acres,cp.land_acres) as comp_acres,
           coalesce(c.executed_lease_rate_psf,c.asking_lease_rate_psf) as lease_psf,
           coalesce(c.price_per_sf,c.sale_price/nullif(coalesce(c.sf,cp.gross_sf),0)) as sale_psf,
           coalesce(c.price_per_acre,c.sale_price/nullif(coalesce(c.land_acres,cp.land_acres),0)) as land_ppa,
           case when v_subj.lat is null or v_subj.lng is null or cp.lat is null or cp.lng is null then null
                else 3958.8*2*asin(sqrt(power(sin(radians(cp.lat-v_subj.lat)/2),2)
                     +cos(radians(v_subj.lat))*cos(radians(cp.lat))*power(sin(radians(cp.lng-v_subj.lng)/2),2)))
           end::numeric as miles
      from comps c join properties cp on cp.id=c.property_id
     where c.property_id<>v_subj.id
       and coalesce(c.executed_at,c.as_of_date,c.created_at::date) >= current_date - interval '6 years'),
  fenced as (select * from raw where (miles is not null and miles<=25)
        or (miles is null and county is not distinct from v_subj.county and v_subj.county is not null)),
  bucketed as (select f.*,b.bucket,
           case b.bucket when 'lease' then f.lease_psf when 'sale' then f.sale_psf else f.land_ppa end as metric
      from fenced f cross join (values ('lease'),('sale'),('land')) as b(bucket)
     where case b.bucket
             when 'lease' then f.lease_psf between 1 and 100 and f.comp_sf>300
                               and f.property_type is distinct from 'land' and coalesce(v_subj.subj_sf,0)>0
             when 'sale' then f.sale_psf between 5 and 900 and f.comp_sf>300
                               and f.property_type is distinct from 'land' and coalesce(v_subj.subj_sf,0)>0
             else f.land_ppa between 5000 and 5000000 and f.comp_acres>0.05 and f.property_type='land'
                  and (v_subj.property_type='land' or coalesce(v_subj.subj_sf,0)<=0) end),
  scored as (select b.*,coalesce(1/(1+power(coalesce(b.miles,8)/3.0,2)),0.1) as w_dist,
           case when b.bucket='land' then
                  case when v_subj.land_acres>0 and b.comp_acres>0
                       then exp(-power(ln(b.comp_acres/v_subj.land_acres),2)/(2*power(0.6,2))) else 0.5 end
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
                  least(1.6,greatest(0.6,case when v_subj.land_acres>0 and s.comp_acres>0
                       then power(v_subj.land_acres/s.comp_acres,s.beta) else 1 end))
                else least(1.6,greatest(0.6,case when v_subj.subj_sf>0 and s.comp_sf>0
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
           row_number() over (partition by d.bucket order by d.weight desc) as rn from discounted d),
  top_comps as (select * from ranked where rn<=30),
  used as (select * from top_comps where included),
  stats as (select u.bucket,count(*) as n,
           weighted_percentile(array_agg(u.adj_metric),array_agg(u.weight),0.50) as p50,
           weighted_percentile(array_agg(u.adj_metric),array_agg(u.weight),0.25) as p25,
           weighted_percentile(array_agg(u.adj_metric),array_agg(u.weight),0.75) as p75,
           round(avg(u.cap_rate_pct),2) as avg_cap,round(avg(u.miles),1) as avg_miles,
           count(*) filter (where u.kind='executed') as n_executed,
           round(avg(u.discount_pct) filter (where u.kind='asking'),1) as avg_asking_discount,
           count(*) filter (where u.class_adj<>1.0) as n_class_adjusted
      from used u group by u.bucket),
  tax as (select coalesce(t.millage,18.0) as millage,coalesce(t.source,'fl_default') as source,t.effective_year,
           coalesce(t.notes,'No rate on file for this county - using an 18 mill Florida default') as notes
      from (select 1) x left join county_tax_rates t on t.county=v_subj.county and t.state=coalesce(v_subj.state,'FL')),
  land_add as (select case when v_excess>0 and v_sale_rate>0 then round(v_excess*v_sale_rate,-3) else 0 end as sale_land,
                      case when v_excess>0 then round(v_excess*v_rent_rate,0) else 0 end as rent_land)
  select jsonb_build_object(
    'property_id',v_subj.id,'as_of',current_date,
    'subject',jsonb_build_object('address',v_subj.address,'county',v_subj.county,
      'property_type',v_subj.property_type,'building_class',v_subj.building_class,'sf',v_subj.subj_sf,
      'land_acres',v_subj.land_acres,'usable_acres',v_subj.usable_acres,'year_built',v_subj.year_built,
      'just_value',v_subj.just_value,'assessed_value',v_subj.assessed_value),
    'method',jsonb_build_object('asking_discount_pct',v_disc,'asking_overprice_k',v_disc_k,
      'weight_asking',v_w_ask,'weight_executed',v_w_exe,
      'class_ladder_measured',v_class<>'{}'::jsonb,'class_factors',v_class),
    'land_component',jsonb_build_object('acres_total',v_subj.land_acres,'acres_usable',v_usable,
      'usable_is_estimated',v_subj.usable_acres is null,'typ_coverage',round(v_typ_cov,4),
      'supported_acres',round(v_supported,2),'excess_acres',round(v_excess,2),
      'base_acre_value',v_excess_val,'size_factor',round(v_sale_factor,3),
      'excess_acre_value',v_sale_rate,'excess_value_measured',v_land_measured,
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
    'land',(select case when s.p50 is null or coalesce(v_subj.land_acres,0)<=0 then null else jsonb_build_object(
        'per_acre',s.p50,'per_acre_low',s.p25,'per_acre_high',s.p75,
        'total',round(s.p50*v_subj.land_acres,-3),'total_low',round(s.p25*v_subj.land_acres,-3),
        'total_high',round(s.p75*v_subj.land_acres,-3),
        'n',s.n,'n_executed',s.n_executed,'avg_miles',s.avg_miles,
        'avg_asking_discount',s.avg_asking_discount,'n_class_adjusted',s.n_class_adjusted,
        'confidence',case when s.n>=8 and s.p50>0 and (s.p75-s.p25)/s.p50<=0.45 then 'high'
                          when s.n>=4 then 'medium' else 'low' end) end
      from stats s where s.bucket='land'),
    'tax',(select jsonb_build_object('county',v_subj.county,'millage',t.millage,
        'rate_pct',round(t.millage/10.0,3),'source',t.source,'effective_year',t.effective_year,'notes',t.notes,
        'basis',(select case when v_subj.property_type='land' and coalesce(v_subj.land_acres,0)>0
              then (select round(s.p50*v_subj.land_acres,-3) from stats s where s.bucket='land')
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
        'miles',round(tc.miles,1),'metric',round(tc.metric,case when tc.bucket='land' then 0 else 2 end),
        'adj_pre',tc.adj_pre,'adj_metric',tc.adj_metric,'size_adj',round(tc.size_adj,3),
        'class_adj',round(tc.class_adj,3),'discount_pct',round(tc.discount_pct,1),'weight',round(tc.weight,4),
        'weight_pct',case when wt.total>0 and tc.included then round(tc.weight/wt.total*100,1) else 0 end,
        'included',tc.included) order by tc.bucket,tc.weight desc)
      from top_comps tc left join (select bucket,sum(weight) as total from used group by bucket) wt on wt.bucket=tc.bucket
    ),'[]'::jsonb),
    'excluded_comp_ids',to_jsonb(v_excl)
  ) into v_result;
  return v_result;
end $fn$;

grant execute on function estimate_property_value(uuid, uuid[]) to authenticated, anon;
