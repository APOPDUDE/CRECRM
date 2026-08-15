-- Transfer-comps pre-flight (plan item 3): these five views read comps gated on price/rate columns
-- only, so a kind='transfer' row (county deed transfer, sale_price set, $0 allowed) would enter the
-- valuation/market math. Add explicit kind allowlists. Behavior-identical today: zero transfer rows.
-- (Views 1-4 here; v_property_market_position in 20260815175455.)

create or replace view v_comp_size_elasticity as
 WITH q AS (
         SELECT p.property_type::text AS ptype,
                CASE
                    WHEN COALESCE(c.executed_lease_rate_psf, c.asking_lease_rate_psf) > 0::numeric THEN 'lease'::text
                    ELSE 'sale'::text
                END AS bucket,
            ln(COALESCE(c.sf, p.gross_sf)::numeric) AS lx,
            ln(NULLIF(
                CASE
                    WHEN COALESCE(c.executed_lease_rate_psf, c.asking_lease_rate_psf) > 0::numeric THEN COALESCE(c.executed_lease_rate_psf, c.asking_lease_rate_psf)
                    ELSE COALESCE(c.price_per_sf, c.sale_price / NULLIF(COALESCE(c.sf, p.gross_sf), 0)::numeric)
                END, 0::numeric)) AS ly
           FROM comps c
             JOIN properties p ON p.id = c.property_id
          WHERE c.kind = ANY (ARRAY['asking'::comp_kind, 'executed'::comp_kind])
            AND COALESCE(c.sf, p.gross_sf) >= 800 AND COALESCE(c.sf, p.gross_sf) <= 500000 AND p.property_type IS NOT NULL AND p.property_type::text <> 'land'::text AND (COALESCE(c.executed_lease_rate_psf, c.asking_lease_rate_psf) >= 3::numeric AND COALESCE(c.executed_lease_rate_psf, c.asking_lease_rate_psf) <= 60::numeric OR COALESCE(c.price_per_sf, c.sale_price / NULLIF(COALESCE(c.sf, p.gross_sf), 0)::numeric) >= 25::numeric AND COALESCE(c.price_per_sf, c.sale_price / NULLIF(COALESCE(c.sf, p.gross_sf), 0)::numeric) <= 500::numeric)
        )
 SELECT ptype,
    bucket,
    count(*) AS n,
    GREATEST(- 0.35, LEAST(0::numeric, regr_slope(ly::double precision, lx::double precision)::numeric)) AS beta
   FROM q
  WHERE ly IS NOT NULL AND lx IS NOT NULL
  GROUP BY ptype, bucket
 HAVING count(*) >= 25;

create or replace view v_comp_class_premium as
 WITH base AS (
         SELECT
                CASE
                    WHEN p.building_class = ANY (ARRAY['A'::text, 'B'::text, 'C'::text]) THEN p.building_class
                    ELSE NULL::text
                END AS bc,
            p.property_type::text AS pt,
                CASE
                    WHEN COALESCE(c.executed_lease_rate_psf, c.asking_lease_rate_psf) > 0::numeric THEN 'lease'::text
                    ELSE 'sale'::text
                END AS bucket,
            COALESCE(c.sf, p.gross_sf)::numeric AS sf,
                CASE
                    WHEN COALESCE(c.executed_lease_rate_psf, c.asking_lease_rate_psf) > 0::numeric THEN COALESCE(c.executed_lease_rate_psf, c.asking_lease_rate_psf)
                    ELSE COALESCE(c.price_per_sf, c.sale_price / NULLIF(COALESCE(c.sf, p.gross_sf), 0)::numeric)
                END AS v
           FROM comps c
             JOIN properties p ON p.id = c.property_id
          WHERE c.kind = ANY (ARRAY['asking'::comp_kind, 'executed'::comp_kind])
            AND (p.building_class = ANY (ARRAY['A'::text, 'B'::text, 'C'::text])) AND p.property_type IS NOT NULL AND COALESCE(c.sf, p.gross_sf) > 300
        ), med AS (
         SELECT base.pt,
            base.bucket,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (base.sf::double precision)) AS msf
           FROM base
          GROUP BY base.pt, base.bucket
        ), adj AS (
         SELECT b.pt,
            b.bucket,
            b.bc,
            b.v::double precision * power(m.msf / b.sf::double precision, COALESCE(e.beta, '-0.15'::numeric)::double precision) AS v_adj
           FROM base b
             JOIN med m ON m.pt = b.pt AND m.bucket = b.bucket
             LEFT JOIN v_comp_size_elasticity e ON e.ptype = b.pt AND e.bucket = b.bucket
          WHERE b.v > 0::numeric AND b.sf > 0::numeric AND m.msf > 0::double precision
        ), per_class AS (
         SELECT adj.pt,
            adj.bucket,
            adj.bc,
            count(*) AS n,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY adj.v_adj) AS m
           FROM adj
          GROUP BY adj.pt, adj.bucket, adj.bc
        ), overall AS (
         SELECT adj.pt,
            adj.bucket,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY adj.v_adj) AS m
           FROM adj
          GROUP BY adj.pt, adj.bucket
        ), factored AS (
         SELECT pc.pt,
            pc.bucket,
            pc.bc,
            pc.n,
            round((pc.m / NULLIF(o.m, 0::double precision))::numeric, 4) AS factor
           FROM per_class pc
             JOIN overall o ON o.pt = pc.pt AND o.bucket = pc.bucket
        ), gated AS (
         SELECT factored.pt,
            factored.bucket,
            bool_and(factored.n::numeric >= (( SELECT valuation_params.value
                   FROM valuation_params
                  WHERE valuation_params.key = 'class_min_n'::text))) AS enough,
            COALESCE(max(factored.factor) FILTER (WHERE factored.bc = 'A'::text), max(factored.factor) FILTER (WHERE factored.bc = 'B'::text), 1::numeric) >= COALESCE(max(factored.factor) FILTER (WHERE factored.bc = 'B'::text), 1::numeric) AND COALESCE(max(factored.factor) FILTER (WHERE factored.bc = 'B'::text), 1::numeric) >= COALESCE(max(factored.factor) FILTER (WHERE factored.bc = 'C'::text), 1::numeric) AS monotonic,
            count(*) AS classes_present
           FROM factored
          GROUP BY factored.pt, factored.bucket
        )
 SELECT f.pt AS ptype,
    f.bucket,
    f.bc AS building_class,
    f.n,
    f.factor
   FROM factored f
     JOIN gated g ON g.pt = f.pt AND g.bucket = f.bucket
  WHERE g.enough AND g.monotonic AND g.classes_present >= 2;

create or replace view v_county_land_metrics as
 WITH sales AS (
         SELECT p_1.county,
            c.sale_price::numeric AS y,
            COALESCE(c.sf, p_1.gross_sf)::numeric AS sf,
            COALESCE(c.land_acres, p_1.land_acres)::numeric AS ac
           FROM comps c
             JOIN properties p_1 ON p_1.id = c.property_id
          WHERE c.kind = ANY (ARRAY['asking'::comp_kind, 'executed'::comp_kind])
            AND c.sale_price >= 50000::numeric AND c.sale_price <= 60000000::numeric AND COALESCE(c.executed_at, c.as_of_date, c.created_at::date) >= (CURRENT_DATE - '6 years'::interval) AND COALESCE(c.sf, p_1.gross_sf) > 500 AND COALESCE(c.land_acres, p_1.land_acres) >= 0.05 AND COALESCE(c.land_acres, p_1.land_acres) <= 100::numeric
        ), cov AS (
         SELECT sales.county,
            sales.y,
            sales.sf,
            sales.ac,
            sales.sf / (sales.ac * 43560::numeric) AS coverage,
            sales.y / sales.sf AS psf
           FROM sales
          WHERE (sales.y / sales.sf) >= 20::numeric AND (sales.y / sales.sf) <= 900::numeric
        ), par AS (
         SELECT cov.county,
            count(*) AS n,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (cov.coverage::double precision))::numeric AS typ_coverage,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (cov.psf::double precision))::numeric AS med_psf
           FROM cov
          GROUP BY cov.county
         HAVING count(*) >= 40
        ), resid AS (
         SELECT c.county,
            (c.y - p_1.med_psf * c.sf) / NULLIF(c.ac - c.sf / p_1.typ_coverage / 43560::numeric, 0::numeric) AS per_excess_acre
           FROM cov c
             JOIN par p_1 ON p_1.county = c.county
          WHERE (c.ac - c.sf / p_1.typ_coverage / 43560::numeric) > 0.15
        )
 SELECT p.county,
    p.n,
    round(p.typ_coverage, 4) AS typ_coverage,
    round(p.med_psf, 2) AS med_psf,
    count(r.*) AS n_excess,
    LEAST(2000000::numeric, GREATEST(10000::numeric, round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (r.per_excess_acre::double precision))::numeric, 0))) AS excess_acre_value
   FROM par p
     LEFT JOIN resid r ON r.county = p.county
  GROUP BY p.county, p.n, p.typ_coverage, p.med_psf
 HAVING count(r.*) >= 15 AND percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (r.per_excess_acre::double precision)) > 0::double precision;

create or replace view v_excess_land_decay as
 WITH sales AS (
         SELECT p.county,
            c.sale_price::numeric AS y,
            COALESCE(c.sf, p.gross_sf)::numeric AS sf,
            COALESCE(c.land_acres, p.land_acres)::numeric AS ac
           FROM comps c
             JOIN properties p ON p.id = c.property_id
          WHERE c.kind = ANY (ARRAY['asking'::comp_kind, 'executed'::comp_kind])
            AND c.sale_price >= 50000::numeric AND c.sale_price <= 60000000::numeric AND COALESCE(c.executed_at, c.as_of_date, c.created_at::date) >= (CURRENT_DATE - '6 years'::interval) AND COALESCE(c.sf, p.gross_sf) > 500 AND COALESCE(c.land_acres, p.land_acres) >= 0.05 AND COALESCE(c.land_acres, p.land_acres) <= 300::numeric
        ), cov AS (
         SELECT sales.county,
            sales.y,
            sales.sf,
            sales.ac,
            sales.sf / (sales.ac * 43560::numeric) AS coverage,
            sales.y / sales.sf AS psf
           FROM sales
          WHERE (sales.y / sales.sf) >= 20::numeric AND (sales.y / sales.sf) <= 900::numeric
        ), par AS (
         SELECT cov.county,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (cov.coverage::double precision))::numeric AS typ_cov,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (cov.psf::double precision))::numeric AS med_psf
           FROM cov
          GROUP BY cov.county
         HAVING count(*) >= 40
        ), r AS (
         SELECT c.ac - c.sf / p.typ_cov / 43560::numeric AS exc,
            (c.y - p.med_psf * c.sf) / NULLIF(c.ac - c.sf / p.typ_cov / 43560::numeric, 0::numeric) AS per_acre
           FROM cov c
             JOIN par p ON p.county = c.county
          WHERE (c.ac - c.sf / p.typ_cov / 43560::numeric) > 0.15
        )
 SELECT count(*) AS n,
    round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (exc::double precision))::numeric, 2) AS med_excess_acres,
    GREATEST('-1.0'::numeric, LEAST(0.0, round(regr_slope(ln(per_acre)::double precision, ln(exc)::double precision)::numeric, 4))) AS beta,
    round(corr(ln(per_acre)::double precision, ln(exc)::double precision)::numeric, 3) AS r
   FROM r
  WHERE per_acre > 1000::numeric AND exc > 0.15;
