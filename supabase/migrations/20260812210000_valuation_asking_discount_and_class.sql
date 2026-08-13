-- Valuation, second pass: asking is CURRENT, not TRUE. And class is the adjustment.
--
-- Three changes Alex called for after reading the first estimates:
--
--  1. Asking comps now outweigh executed ones. Counter-intuitive until you look
--     at the ages: asking comps are a MONTH old on median, executed ones 1.5
--     YEARS (3.2 avg). Executed is the only ground truth for what someone paid,
--     but it is truth about a market that has moved. Asking is today.
--  2. Because asking is only asking, its LEVEL is now corrected, not merely
--     down-weighted. Weighting a comp lower reduces its influence; it does not
--     stop a comp set that is 2/3 asking prices from settling at asking level.
--     A haircut does. Default 5% (Alex's number - see below on why it is not
--     measured), scaled per comp by how far above its peers it is asking.
--  3. Building class A/B/C drives a premium/discount, measured off our own
--     comps where the data supports it.
--
-- WHY THE 5% IS NOT MEASURED: the honest way would be to pair an asking comp
-- with the executed comp that later landed on the same property. There are FOUR
-- such lease pairs in the database and ZERO sale pairs, and the four disagree
-- wildly because the asking is on the building and the execution on one suite.
-- Population-level asking-vs-executed is worse than useless here: executed
-- comps are 1.5 years older, so the gap would be mostly market drift, which the
-- recency weight already handles. So this is Alex's market knowledge, stored as
-- an editable parameter rather than dressed up as a measurement.

-- ---------------------------------------------------------------------------
-- 1. Tunables. Every judgement number in the estimate lives here, so retuning
--    it is an UPDATE rather than a migration.
-- ---------------------------------------------------------------------------
create table if not exists valuation_params (
  key text primary key,
  value numeric not null,
  notes text,
  updated_at timestamptz not null default now()
);

alter table valuation_params enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'valuation_params' and policyname = 'valuation_params_auth_all') then
    create policy valuation_params_auth_all on valuation_params for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'valuation_params' and policyname = 'valuation_params_anon_read') then
    create policy valuation_params_anon_read on valuation_params for select to anon using (true);
  end if;
end $$;

drop trigger if exists valuation_params_updated_at on valuation_params;
create trigger valuation_params_updated_at before update on valuation_params
  for each row execute function set_updated_at();

insert into valuation_params (key, value, notes) values
  ('weight_asking',           1.00, 'Asking comps outweigh executed: median age 1 month vs 1.5 years.'),
  ('weight_executed',         0.85, 'Ground truth on what was paid, but for an older market.'),
  ('asking_discount_pct',     5.00, 'Base haircut turning an asking price into an expected trade price.'),
  ('asking_overprice_k',      2.00, 'How hard the haircut scales with a comp asking above its peers. 0 = flat 5%.'),
  ('asking_discount_min_pct', 0.00, 'An asking price is never adjusted UP, however cheap it looks.'),
  ('asking_discount_max_pct',20.00, 'Ceiling, so one wild asking price cannot swing the set.'),
  ('class_factor_a',          1.10, 'Fallback class ladder, used where our own comps cannot measure one.'),
  ('class_factor_b',          1.00, 'Class B is the reference.'),
  ('class_factor_c',          0.92, 'Fallback class ladder.'),
  ('class_min_n',            15.00, 'Comps required in EVERY class of a type before trusting a measured ladder.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The measured class ladder.
--
--    Size has to be neutralised FIRST or this just re-reads the size effect:
--    on raw medians, class A industrial leases for LESS per foot than class C,
--    because class A industrial is big-box distribution and class C is small-bay
--    infill. Size-adjusted, the ladder turns the right way up (A 15.49 / B 14.22
--    / C 13.51) and means what it should.
--
--    A cell is only trusted when every class has `class_min_n` comps AND the
--    ladder is monotonic A >= B >= C. Class is a quality ORDER by definition, so
--    a set that measures C above A is telling us it is noisy, not that C is
--    worth more. Industrial SALE currently fails that test (A n=20 reads below
--    B) and correctly falls back to the default ladder.
-- ---------------------------------------------------------------------------
create or replace view v_comp_class_premium as
with base as (
  select case when p.building_class in ('A','B','C') then p.building_class end as bc,
         p.property_type::text as pt,
         case when coalesce(c.executed_lease_rate_psf, c.asking_lease_rate_psf) > 0 then 'lease' else 'sale' end as bucket,
         coalesce(c.sf, p.gross_sf)::numeric as sf,
         case when coalesce(c.executed_lease_rate_psf, c.asking_lease_rate_psf) > 0
              then coalesce(c.executed_lease_rate_psf, c.asking_lease_rate_psf)
              else coalesce(c.price_per_sf, c.sale_price / nullif(coalesce(c.sf, p.gross_sf), 0))
         end as v
  from comps c
  join properties p on p.id = c.property_id
  where p.building_class in ('A','B','C')
    and p.property_type is not null
    and coalesce(c.sf, p.gross_sf) > 300
),
med as (
  select pt, bucket, percentile_cont(0.5) within group (order by sf) as msf
  from base group by pt, bucket
),
adj as (
  select b.pt, b.bucket, b.bc,
         b.v * power(m.msf / b.sf, coalesce(e.beta, -0.15)) as v_adj
  from base b
  join med m on m.pt = b.pt and m.bucket = b.bucket
  left join v_comp_size_elasticity e on e.ptype = b.pt and e.bucket = b.bucket
  where b.v > 0 and b.sf > 0 and m.msf > 0
),
per_class as (
  select pt, bucket, bc, count(*) as n,
         percentile_cont(0.5) within group (order by v_adj) as m
  from adj group by pt, bucket, bc
),
overall as (
  select pt, bucket, percentile_cont(0.5) within group (order by v_adj) as m
  from adj group by pt, bucket
),
factored as (
  select pc.pt, pc.bucket, pc.bc, pc.n,
         round((pc.m / nullif(o.m, 0))::numeric, 4) as factor
  from per_class pc
  join overall o on o.pt = pc.pt and o.bucket = pc.bucket
),
gated as (
  select pt, bucket,
         bool_and(n >= (select value from valuation_params where key = 'class_min_n')) as enough,
         coalesce(max(factor) filter (where bc = 'A'), max(factor) filter (where bc = 'B'), 1)
           >= coalesce(max(factor) filter (where bc = 'B'), 1)
         and coalesce(max(factor) filter (where bc = 'B'), 1)
           >= coalesce(max(factor) filter (where bc = 'C'), 1) as monotonic,
         count(*) as classes_present
  from factored group by pt, bucket
)
select f.pt as ptype, f.bucket, f.bc as building_class, f.n, f.factor
from factored f
join gated g on g.pt = f.pt and g.bucket = f.bucket
where g.enough and g.monotonic and g.classes_present >= 2;

comment on view v_comp_class_premium is
  'Size-neutralised A/B/C rate ladder per property_type x lease|sale, as a factor against that cell''s overall median. Only emitted where every class clears class_min_n and the ladder is monotonic; estimate_property_value falls back to the class_factor_* params otherwise.';

-- ---------------------------------------------------------------------------
-- 3. The engine, rebuilt around the two new adjustments.
--
--    Order matters: size, then class, then the asking haircut. The haircut is
--    measured against peers that have ALREADY been size- and class-adjusted,
--    so "this one is asking above the rest" means above the rest LIKE IT,
--    rather than above a set it was never comparable to.
-- ---------------------------------------------------------------------------
create or replace function estimate_property_value(
  p_property_id uuid,
  p_exclude_comp_ids uuid[] default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_subj record;
  v_excl uuid[];
  v_result jsonb;
  v_beta_lease numeric;
  v_beta_sale numeric;
  v_beta_land numeric;
  v_params jsonb;
  v_class jsonb;
  v_w_ask numeric;
  v_w_exe numeric;
  v_disc numeric;
  v_disc_k numeric;
  v_disc_min numeric;
  v_disc_max numeric;
begin
  select p.id, p.address, p.city, p.state, p.zip, p.county, p.lat, p.lng,
         p.property_type::text as property_type, p.year_built, p.land_acres, p.usable_acres,
         p.just_value, p.assessed_value,
         case when p.building_class in ('A','B','C') then p.building_class end as building_class,
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

  -- Everything that would otherwise be re-derived per row is loaded ONCE. A
  -- correlated reference to either of these views re-runs a full regression per
  -- candidate comp and blows PostgREST's 8s timeout - it has already happened.
  select coalesce(max(beta) filter (where ptype = v_subj.property_type and bucket = 'lease'), -0.15),
         coalesce(max(beta) filter (where ptype = v_subj.property_type and bucket = 'sale'), -0.15),
         coalesce(max(beta) filter (where ptype = 'land' and bucket = 'sale'), -0.15)
    into v_beta_lease, v_beta_sale, v_beta_land
    from v_comp_size_elasticity;

  select jsonb_object_agg(key, value) into v_params from valuation_params;

  -- Measured ladder for THIS property type, keyed 'bucket|class'; empty when the
  -- type's data failed the n / monotonicity gate, and the fallback takes over.
  select coalesce(jsonb_object_agg(bucket || '|' || building_class, factor), '{}'::jsonb)
    into v_class
    from v_comp_class_premium
   where ptype = v_subj.property_type;

  v_w_ask    := coalesce((v_params->>'weight_asking')::numeric, 1.00);
  v_w_exe    := coalesce((v_params->>'weight_executed')::numeric, 0.85);
  v_disc     := coalesce((v_params->>'asking_discount_pct')::numeric, 5.00);
  v_disc_k   := coalesce((v_params->>'asking_overprice_k')::numeric, 2.00);
  v_disc_min := coalesce((v_params->>'asking_discount_min_pct')::numeric, 0.00);
  v_disc_max := coalesce((v_params->>'asking_discount_max_pct')::numeric, 20.00);

  with raw as (
    select c.id                                              as comp_id,
           c.property_id,
           cp.address, cp.city, cp.county,
           cp.property_type::text                            as property_type,
           case when cp.building_class in ('A','B','C') then cp.building_class end as building_class,
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
             when 'lease' then f.lease_psf between 1 and 100 and f.comp_sf > 300
                               and f.property_type is distinct from 'land'
                               and coalesce(v_subj.subj_sf, 0) > 0
             when 'sale'  then f.sale_psf between 5 and 900 and f.comp_sf > 300
                               and f.property_type is distinct from 'land'
                               and coalesce(v_subj.subj_sf, 0) > 0
             else f.land_ppa between 5000 and 5000000 and f.comp_acres > 0.05
                  and f.property_type = 'land'
                  and (v_subj.property_type = 'land' or coalesce(v_subj.subj_sf, 0) <= 0)
           end
  ),
  scored as (
    select b.*,
           coalesce(1 / (1 + power(coalesce(b.miles, 8) / 3.0, 2)), 0.1)                    as w_dist,
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
           power(0.5, (current_date - b.comp_date)::numeric / 365.25 / 3.0)::numeric        as w_time,
           -- Asking now leads, because asking is now.
           case when b.kind = 'executed' then v_w_exe else v_w_ask end                      as w_kind,
           case when b.verified then 1.0 else 0.9 end::numeric                              as w_verified,
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
           case
             when s.bucket = 'land' then
               least(1.6, greatest(0.6,
                 case when v_subj.land_acres > 0 and s.comp_acres > 0
                      then power(v_subj.land_acres / s.comp_acres, s.beta) else 1 end))
             else
               least(1.6, greatest(0.6,
                 case when v_subj.subj_sf > 0 and s.comp_sf > 0
                      then power(v_subj.subj_sf / s.comp_sf, s.beta) else 1 end))
           end::numeric as size_adj,
           -- Class premium: restate a class C comp as if it were the subject's
           -- class. Unknown class on either side means NO adjustment - an
           -- unclassified building is not a worse one, and 93% of the book is
           -- unclassified today.
           case
             when v_subj.building_class is null or s.building_class is null
               or s.bucket = 'land' then 1.0
             when v_subj.building_class = s.building_class then 1.0
             else least(1.35, greatest(0.75,
                    coalesce((v_class ->> (s.bucket || '|' || v_subj.building_class))::numeric,
                             (v_params ->> ('class_factor_' || lower(v_subj.building_class)))::numeric, 1.0)
                  / nullif(coalesce((v_class ->> (s.bucket || '|' || s.building_class))::numeric,
                             (v_params ->> ('class_factor_' || lower(s.building_class)))::numeric, 1.0), 0)))
           end::numeric as class_adj
      from scored s
  ),
  deduped as (
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
  pre as (
    -- The comp restated at the subject's size and class, BEFORE any haircut.
    select d.*, round(d.metric * d.size_adj * d.class_adj, case when d.bucket = 'land' then 0 else 2 end) as adj_pre
      from deduped d
  ),
  peers as (
    -- Plain median, not weighted: this is the yardstick a single asking price is
    -- held against, so it must not be moved by that price's own weight.
    -- percentile_cont has no numeric variant - without the cast back, peer_med is
    -- double precision and poisons every downstream round(numeric, int).
    select bucket,
           percentile_cont(0.5) within group (order by (adj_pre::double precision))::numeric as peer_med
      from pre group by bucket
  ),
  discounted as (
    select p.*,
           pr.peer_med,
           case
             when p.kind = 'executed' then 0::numeric
             else least(v_disc_max, greatest(v_disc_min,
                    v_disc * (1 + v_disc_k *
                      case when pr.peer_med > 0 then (p.adj_pre / pr.peer_med) - 1 else 0 end)))
           end as discount_pct
      from pre p
      join peers pr on pr.bucket = p.bucket
  ),
  ranked as (
    select d.*,
           round(d.adj_pre * (1 - d.discount_pct / 100), case when d.bucket = 'land' then 0 else 2 end) as adj_metric,
           not (d.comp_id = any(v_excl)) as included,
           row_number() over (partition by d.bucket order by d.weight desc) as rn
      from discounted d
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
           count(*) filter (where u.kind = 'executed')                         as n_executed,
           round(avg(u.discount_pct) filter (where u.kind = 'asking'), 1)      as avg_asking_discount,
           count(*) filter (where u.class_adj <> 1.0)                          as n_class_adjusted
      from used u
     group by u.bucket
  ),
  tax as (
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
      'building_class', v_subj.building_class,
      'sf', v_subj.subj_sf,
      'land_acres', v_subj.land_acres,
      'year_built', v_subj.year_built,
      'just_value', v_subj.just_value,
      'assessed_value', v_subj.assessed_value
    ),
    'method', jsonb_build_object(
      'asking_discount_pct', v_disc,
      'asking_overprice_k', v_disc_k,
      'weight_asking', v_w_ask,
      'weight_executed', v_w_exe,
      'class_ladder_measured', v_class <> '{}'::jsonb,
      'class_factors', v_class
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
        'avg_asking_discount', s.avg_asking_discount, 'n_class_adjusted', s.n_class_adjusted,
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
        'avg_asking_discount', s.avg_asking_discount, 'n_class_adjusted', s.n_class_adjusted,
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
        'avg_asking_discount', s.avg_asking_discount, 'n_class_adjusted', s.n_class_adjusted,
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
               'building_class', tc.building_class,
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
               'adj_pre', tc.adj_pre,
               'adj_metric', tc.adj_metric,
               'size_adj', round(tc.size_adj, 3),
               'class_adj', round(tc.class_adj, 3),
               'discount_pct', round(tc.discount_pct, 1),
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
end $fn$;

grant execute on function estimate_property_value(uuid, uuid[]) to authenticated, anon;
