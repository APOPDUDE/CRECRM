-- Property value estimate ("what would this trade for / rent for / cost in taxes")
--
-- Replaces the county-average market card on the property page with a real
-- comp-driven estimate. Everything that decides a number lives HERE, not in the
-- React app, so n8n / Slack / the phone Claude can ask for the same estimate.
--
-- Three pieces:
--   1. county_tax_rates        - millage per county, editable (seeded, approximate)
--   2. valuation_comp_exclusions - the comps Alex has thrown out per property
--   3. estimate_property_value() - the engine; returns the number AND its math

-- ---------------------------------------------------------------------------
-- 1. Millage. FL property tax = taxable value x millage / 1000. We hold no tax
--    bills, so the rate is a per-county input the broker can correct; every
--    seeded row is flagged `source='seed_estimate'` so the UI can say so.
-- ---------------------------------------------------------------------------
create table if not exists county_tax_rates (
  county text not null,
  state text not null default 'FL',
  millage numeric(6,3) not null check (millage > 0 and millage < 100),
  effective_year integer,
  source text not null default 'seed_estimate',
  notes text,
  updated_at timestamptz not null default now(),
  primary key (county, state)
);

alter table county_tax_rates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'county_tax_rates' and policyname = 'county_tax_rates_auth_all') then
    create policy county_tax_rates_auth_all on county_tax_rates for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'county_tax_rates' and policyname = 'county_tax_rates_anon_read') then
    create policy county_tax_rates_anon_read on county_tax_rates for select to anon using (true);
  end if;
end $$;

drop trigger if exists county_tax_rates_updated_at on county_tax_rates;
create trigger county_tax_rates_updated_at before update on county_tax_rates
  for each row execute function set_updated_at();

-- Aggregate millage (county + school + typical municipal/special districts),
-- approximate FY2025. Deliberately rough: the point is a defensible starting
-- number the broker overwrites with the real rate when he knows it.
insert into county_tax_rates (county, state, millage, effective_year, notes) values
  ('Hillsborough','FL',19.500,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Pinellas','FL',20.000,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Pasco','FL',18.000,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Polk','FL',18.500,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Manatee','FL',16.000,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Sarasota','FL',15.000,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Hernando','FL',18.000,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Lee','FL',16.000,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Charlotte','FL',16.500,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Collier','FL',11.500,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Orange','FL',18.500,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Osceola','FL',19.500,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Lake','FL',17.500,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Seminole','FL',17.000,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Citrus','FL',16.000,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Miami-Dade','FL',20.000,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Duval','FL',19.000,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Brevard','FL',15.500,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Marion','FL',16.500,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Sumter','FL',14.000,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Highlands','FL',17.000,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('DeSoto','FL',18.000,2025,'Approximate aggregate millage - verify against the tax bill'),
  ('Hardee','FL',18.000,2025,'Approximate aggregate millage - verify against the tax bill')
on conflict (county, state) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Struck comps. "This one doesn't fit my building" is a judgement the CRM
--    has to remember, so the estimate is stable between visits.
-- ---------------------------------------------------------------------------
create table if not exists valuation_comp_exclusions (
  property_id uuid not null references properties(id) on delete cascade,
  comp_id uuid not null references comps(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (property_id, comp_id)
);
create index if not exists valuation_comp_exclusions_property_idx on valuation_comp_exclusions(property_id);

alter table valuation_comp_exclusions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'valuation_comp_exclusions' and policyname = 'valuation_comp_exclusions_auth_all') then
    create policy valuation_comp_exclusions_auth_all on valuation_comp_exclusions for all to authenticated using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3a. Weighted percentile. A weighted MEDIAN, not a mean: one $60 PSF office
--     comp in a warehouse set should not drag the whole estimate.
-- ---------------------------------------------------------------------------
create or replace function weighted_percentile(p_vals numeric[], p_wts numeric[], p_p numeric)
returns numeric
language sql
immutable
as $$
  with t as (
    select v, w from unnest(p_vals, p_wts) as u(v, w) where v is not null and w > 0
  ), o as (
    select v,
           sum(w) over (order by v rows between unbounded preceding and current row) as cw,
           sum(w) over () as tw
    from t
  )
  select min(v) from o where cw >= tw * p_p;
$$;

-- ---------------------------------------------------------------------------
-- 3b. Size elasticity: small spaces rent and sell for more per foot. Measured
--     off our own comp set per property type, so it moves with the market
--     rather than being a constant somebody typed once.
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
  where coalesce(c.sf, p.gross_sf) > 300
    and p.property_type is not null
)
select ptype,
       bucket,
       count(*) as n,
       -- clamped into [-0.5, 0]: negative (bigger = cheaper per foot) and never
       -- steep enough to make a 5x size gap swing the number by more than ~2x.
       greatest(-0.5::numeric, least(0::numeric, regr_slope(ly, lx)::numeric)) as beta
from q
where ly is not null and lx is not null
group by ptype, bucket
having count(*) >= 25;

-- ---------------------------------------------------------------------------
-- 3c. The engine.
--
-- Returns one jsonb doc: the headline numbers, the comps that produced them
-- (each with its own weight and adjustment, so the UI can show the math), and
-- the tax build-up. Pass p_exclude_comp_ids to model "what if I drop these";
-- pass null and it uses whatever the broker has already struck for the property.
-- ---------------------------------------------------------------------------
create or replace function estimate_property_value(
  p_property_id uuid,
  p_exclude_comp_ids uuid[] default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_subj record;
  v_excl uuid[];
  v_result jsonb;
  v_beta_lease numeric;
  v_beta_sale numeric;
  v_beta_land numeric;
begin
  select p.id, p.address, p.city, p.state, p.zip, p.county, p.lat, p.lng,
         p.property_type::text as property_type, p.year_built, p.land_acres, p.usable_acres,
         p.just_value, p.assessed_value,
         coalesce(p.gross_sf, p.heated_sf)::numeric as subj_sf
    into v_subj
    from properties p
   where p.id = p_property_id;

  if not found then
    return null;
  end if;

  v_excl := coalesce(
    p_exclude_comp_ids,
    (select coalesce(array_agg(comp_id), '{}'::uuid[]) from valuation_comp_exclusions where property_id = p_property_id)
  );

  -- Read the elasticities ONCE, up front. Left inline as a CTE they were
  -- re-derived per candidate comp - a full regression over every comp in the
  -- database, thousands of times over, which blew PostgREST's statement timeout.
  -- Land borrows the land-type sale curve; there is no separate land bucket.
  select coalesce(max(beta) filter (where ptype = v_subj.property_type and bucket = 'lease'), -0.15),
         coalesce(max(beta) filter (where ptype = v_subj.property_type and bucket = 'sale'), -0.15),
         coalesce(max(beta) filter (where ptype = 'land' and bucket = 'sale'), -0.15)
    into v_beta_lease, v_beta_sale, v_beta_land
    from v_comp_size_elasticity;

  with raw as (
    select c.id                                              as comp_id,
           c.property_id,
           cp.address, cp.city, cp.county,
           cp.property_type::text                            as property_type,
           c.kind::text                                      as kind,
           c.verified,
           c.tenant_name,
           c.lease_structure::text                           as lease_structure,
           c.term_months, c.opex_psf, c.cap_rate_pct, c.sale_price,
           coalesce(c.executed_at, c.as_of_date, c.created_at::date) as comp_date,
           coalesce(c.sf, cp.gross_sf)::numeric              as comp_sf,
           coalesce(c.land_acres, cp.land_acres)             as comp_acres,
           coalesce(c.executed_lease_rate_psf, c.asking_lease_rate_psf) as lease_psf,
           coalesce(c.price_per_sf, c.sale_price / nullif(coalesce(c.sf, cp.gross_sf), 0)) as sale_psf,
           coalesce(c.price_per_acre, c.sale_price / nullif(coalesce(c.land_acres, cp.land_acres), 0)) as land_ppa,
           case
             when v_subj.lat is null or v_subj.lng is null or cp.lat is null or cp.lng is null then null
             else 3958.8 * 2 * asin(sqrt(
                    power(sin(radians(cp.lat - v_subj.lat) / 2), 2)
                  + cos(radians(v_subj.lat)) * cos(radians(cp.lat))
                    * power(sin(radians(cp.lng - v_subj.lng) / 2), 2)))
           end::numeric                                      as miles
      from comps c
      join properties cp on cp.id = c.property_id
     where c.property_id <> v_subj.id
       and coalesce(c.executed_at, c.as_of_date, c.created_at::date) >= current_date - interval '6 years'
  ),
  fenced as (
    -- Same county, or within 25 miles. Beyond that it stops being a comp.
    select * from raw
     where (miles is not null and miles <= 25)
        or (miles is null and county is not distinct from v_subj.county and v_subj.county is not null)
  ),
  bucketed as (
    select f.*, b.bucket,
           case b.bucket
             when 'lease' then f.lease_psf
             when 'sale'  then f.sale_psf
             else f.land_ppa
           end as metric
      from fenced f
      cross join (values ('lease'), ('sale'), ('land')) as b(bucket)
     where case b.bucket
             -- A dirt sale carries no building rate, so land-typed comps are
             -- barred from the building buckets outright, not just penalised.
             -- and no building SF on the subject means no building rate to quote.
             when 'lease' then f.lease_psf between 1 and 100 and f.comp_sf > 300
                               and f.property_type is distinct from 'land'
                               and coalesce(v_subj.subj_sf, 0) > 0
             when 'sale'  then f.sale_psf between 5 and 900 and f.comp_sf > 300
                               and f.property_type is distinct from 'land'
                               and coalesce(v_subj.subj_sf, 0) > 0
             -- Land runs only for land: on an improved property the dirt is a
             -- residual, not a headline, and quoting both invites double-counting.
             else f.land_ppa between 5000 and 5000000 and f.comp_acres > 0.05
                  and f.property_type = 'land'
                  and (v_subj.property_type = 'land' or coalesce(v_subj.subj_sf, 0) <= 0)
           end
  ),
  scored as (
    select b.*,
           -- Distance decay: half weight at 3 miles, near-zero past 15.
           coalesce(1 / (1 + power(coalesce(b.miles, 8) / 3.0, 2)), 0.1)                    as w_dist,
           -- Log-normal size similarity. A 2x size gap costs ~14% of the weight.
           case
             when b.bucket = 'land' then
               case when v_subj.land_acres > 0 and b.comp_acres > 0
                    then exp(-power(ln(b.comp_acres / v_subj.land_acres), 2) / (2 * power(0.6, 2)))
                    else 0.5 end
             else
               case when v_subj.subj_sf > 0 and b.comp_sf > 0
                    then exp(-power(ln(b.comp_sf / v_subj.subj_sf), 2) / (2 * power(0.7, 2)))
                    else 0.5 end
           end::numeric                                                                     as w_size,
           -- Recency: three-year half-life.
           power(0.5, (current_date - b.comp_date)::numeric / 365.25 / 3.0)::numeric as w_time,
           -- A signed deal beats an asking price.
           case when b.kind = 'executed' then 1.0 else 0.72 end::numeric                    as w_kind,
           case when b.verified then 1.0 else 0.9 end::numeric                              as w_verified,
           -- Wrong property type is a soft penalty, not a filter: on a thin
           -- submarket four off-type comps beat no comps at all.
           case when v_subj.property_type is null or b.property_type is null then 0.7
                when b.property_type = v_subj.property_type then 1.0
                else 0.35 end::numeric                                                      as w_type,
           case b.bucket
             when 'lease' then v_beta_lease
             when 'sale'  then v_beta_sale
             else v_beta_land
           end                                                                              as beta
      from bucketed b
  ),
  adjusted as (
    select s.*,
           (s.w_dist * s.w_size * s.w_time * s.w_kind * s.w_verified * s.w_type)::numeric as weight,
           -- Size adjustment: restate the comp's rate at the subject's size,
           -- clamped so a wild size gap can't triple the number.
           case
             when s.bucket = 'land' then
               least(1.6, greatest(0.6,
                 case when v_subj.land_acres > 0 and s.comp_acres > 0
                      then power(v_subj.land_acres / s.comp_acres, s.beta) else 1 end))
             else
               least(1.6, greatest(0.6,
                 case when v_subj.subj_sf > 0 and s.comp_sf > 0
                      then power(v_subj.subj_sf / s.comp_sf, s.beta) else 1 end))
           end::numeric as size_adj
      from scored s
  ),
  deduped as (
    -- One property, one comp. A listing that has been re-priced four times
    -- leaves four asking rows; counting them all would let a single building
    -- carry four times its weight in the median.
    select * from (
      select a.*,
             row_number() over (
               partition by a.bucket, a.property_id
               order by a.weight desc, a.comp_date desc
             ) as prn
        from adjusted a
       where a.weight >= 0.01
    ) q
     where prn = 1
  ),
  ranked as (
    select d.*,
           round(d.metric * d.size_adj, case when d.bucket = 'land' then 0 else 2 end) as adj_metric,
           not (d.comp_id = any(v_excl)) as included,
           row_number() over (partition by d.bucket order by d.weight desc) as rn
      from deduped d
  ),
  top_comps as (
    select * from ranked where rn <= 30
  ),
  used as (
    select * from top_comps where included
  ),
  stats as (
    select u.bucket,
           count(*)                                                            as n,
           weighted_percentile(array_agg(u.adj_metric), array_agg(u.weight), 0.50) as p50,
           weighted_percentile(array_agg(u.adj_metric), array_agg(u.weight), 0.25) as p25,
           weighted_percentile(array_agg(u.adj_metric), array_agg(u.weight), 0.75) as p75,
           round(avg(u.cap_rate_pct), 2)                                       as avg_cap,
           round(avg(u.miles), 1)                                              as avg_miles,
           count(*) filter (where u.kind = 'executed')                         as n_executed
      from used u
     group by u.bucket
  ),
  tax as (
    -- Always returns a row: an unknown county falls back to 18 mills rather
    -- than leaving the tax line blank, and says so in `source`.
    select coalesce(t.millage, 18.0)          as millage,
           coalesce(t.source, 'fl_default')   as source,
           t.effective_year,
           coalesce(t.notes, 'No rate on file for this county - using an 18 mill Florida default') as notes
      from (select 1) x
      left join county_tax_rates t
        on t.county = v_subj.county and t.state = coalesce(v_subj.state, 'FL')
  )
  select jsonb_build_object(
    'property_id', v_subj.id,
    'as_of', current_date,
    'subject', jsonb_build_object(
      'address', v_subj.address,
      'county', v_subj.county,
      'property_type', v_subj.property_type,
      'sf', v_subj.subj_sf,
      'land_acres', v_subj.land_acres,
      'year_built', v_subj.year_built,
      'just_value', v_subj.just_value,
      'assessed_value', v_subj.assessed_value
    ),
    'sale', (
      select case when s.p50 is null then null else jsonb_build_object(
        'psf', s.p50,
        'psf_low', s.p25,
        'psf_high', s.p75,
        'total', case when v_subj.subj_sf > 0 then round(s.p50 * v_subj.subj_sf, -3) end,
        'total_low', case when v_subj.subj_sf > 0 then round(s.p25 * v_subj.subj_sf, -3) end,
        'total_high', case when v_subj.subj_sf > 0 then round(s.p75 * v_subj.subj_sf, -3) end,
        'cap_rate', s.avg_cap,
        'n', s.n, 'n_executed', s.n_executed, 'avg_miles', s.avg_miles,
        'confidence', case when s.n >= 8 and s.p50 > 0 and (s.p75 - s.p25) / s.p50 <= 0.45 then 'high'
                           when s.n >= 4 then 'medium' else 'low' end
      ) end from stats s where s.bucket = 'sale'
    ),
    'lease', (
      select case when s.p50 is null then null else jsonb_build_object(
        'psf', s.p50,
        'psf_low', s.p25,
        'psf_high', s.p75,
        'monthly', case when v_subj.subj_sf > 0 then round(s.p50 * v_subj.subj_sf / 12, 0) end,
        'monthly_low', case when v_subj.subj_sf > 0 then round(s.p25 * v_subj.subj_sf / 12, 0) end,
        'monthly_high', case when v_subj.subj_sf > 0 then round(s.p75 * v_subj.subj_sf / 12, 0) end,
        'annual', case when v_subj.subj_sf > 0 then round(s.p50 * v_subj.subj_sf, 0) end,
        'n', s.n, 'n_executed', s.n_executed, 'avg_miles', s.avg_miles,
        'confidence', case when s.n >= 8 and s.p50 > 0 and (s.p75 - s.p25) / s.p50 <= 0.45 then 'high'
                           when s.n >= 4 then 'medium' else 'low' end
      ) end from stats s where s.bucket = 'lease'
    ),
    'land', (
      select case when s.p50 is null or coalesce(v_subj.land_acres, 0) <= 0 then null else jsonb_build_object(
        'per_acre', s.p50,
        'per_acre_low', s.p25,
        'per_acre_high', s.p75,
        'total', round(s.p50 * v_subj.land_acres, -3),
        'total_low', round(s.p25 * v_subj.land_acres, -3),
        'total_high', round(s.p75 * v_subj.land_acres, -3),
        'n', s.n, 'n_executed', s.n_executed, 'avg_miles', s.avg_miles,
        'confidence', case when s.n >= 8 and s.p50 > 0 and (s.p75 - s.p25) / s.p50 <= 0.45 then 'high'
                           when s.n >= 4 then 'medium' else 'low' end
      ) end from stats s where s.bucket = 'land'
    ),
    'tax', (
      select jsonb_build_object(
        'county', v_subj.county,
        'millage', t.millage,
        'rate_pct', round(t.millage / 10.0, 3),
        'source', t.source,
        'effective_year', t.effective_year,
        'notes', t.notes,
        -- Basis = what we think it's worth. A Florida sale resets just value to
        -- roughly market, so this is the bill a buyer inherits - not the seller's.
        'basis', (
          select case
            when v_subj.property_type = 'land' and coalesce(v_subj.land_acres, 0) > 0
              then (select round(s.p50 * v_subj.land_acres, -3) from stats s where s.bucket = 'land')
            when v_subj.subj_sf > 0
              then (select round(s.p50 * v_subj.subj_sf, -3) from stats s where s.bucket = 'sale')
          end
        ),
        'assessed_value', v_subj.assessed_value,
        'current_annual', case when v_subj.assessed_value > 0
                               then round(v_subj.assessed_value * t.millage / 1000.0, 0) end
      ) from tax t
    ),
    'comps', coalesce((
      select jsonb_agg(jsonb_build_object(
               'comp_id', tc.comp_id,
               'property_id', tc.property_id,
               'address', tc.address,
               'city', tc.city,
               'county', tc.county,
               'property_type', tc.property_type,
               'bucket', tc.bucket,
               'kind', tc.kind,
               'verified', tc.verified,
               'tenant_name', tc.tenant_name,
               'lease_structure', tc.lease_structure,
               'term_months', tc.term_months,
               'opex_psf', tc.opex_psf,
               'cap_rate_pct', tc.cap_rate_pct,
               'sale_price', tc.sale_price,
               'comp_date', tc.comp_date,
               'sf', tc.comp_sf,
               'acres', tc.comp_acres,
               'miles', round(tc.miles, 1),
               'metric', round(tc.metric, case when tc.bucket = 'land' then 0 else 2 end),
               'adj_metric', tc.adj_metric,
               'size_adj', round(tc.size_adj, 3),
               'weight', round(tc.weight, 4),
               'weight_pct', case when wt.total > 0 and tc.included
                                  then round(tc.weight / wt.total * 100, 1) else 0 end,
               'included', tc.included
             ) order by tc.bucket, tc.weight desc)
        from top_comps tc
        left join (select bucket, sum(weight) as total from used group by bucket) wt on wt.bucket = tc.bucket
    ), '[]'::jsonb),
    'excluded_comp_ids', to_jsonb(v_excl)
  )
  into v_result;

  return v_result;
end $$;

comment on function estimate_property_value(uuid, uuid[]) is
  'Comp-driven value / rent / tax estimate for one property. Returns the headline numbers plus every comp that fed them, with its weight, so the math is inspectable. Pass p_exclude_comp_ids to model dropped comps; pass null to use the stored valuation_comp_exclusions.';

grant execute on function estimate_property_value(uuid, uuid[]) to authenticated, anon;
grant execute on function weighted_percentile(numeric[], numeric[], numeric) to authenticated, anon;
