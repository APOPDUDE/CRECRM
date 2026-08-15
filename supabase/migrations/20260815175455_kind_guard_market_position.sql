-- Same pre-flight, fifth view: guards in the two CTEs that read comps directly
-- (the ref CTE reads v_property_current_asking, which is already kind='asking').
create or replace view v_property_market_position as
 WITH elast_bldg AS (
         SELECT q.ptype,
            q.dt,
            GREATEST('-0.7'::numeric::double precision, LEAST(0::double precision, regr_slope(q.ly::double precision, q.lx::double precision)))::numeric AS b
           FROM ( SELECT p.property_type::text AS ptype,
                    c.deal_type::text AS dt,
                    ln(c.sf::numeric) AS lx,
                    ln(NULLIF(
                        CASE
                            WHEN c.deal_type = 'lease'::deal_type THEN COALESCE(c.executed_lease_rate_psf, c.asking_lease_rate_psf)
                            ELSE COALESCE(c.price_per_sf,
                            CASE
                                WHEN c.sf > 0 THEN c.sale_price / c.sf::numeric
                                ELSE NULL::numeric
                            END)
                        END, 0::numeric)) AS ly
                   FROM comps c
                     JOIN properties p ON p.id = c.property_id
                  WHERE c.kind = ANY (ARRAY['asking'::comp_kind, 'executed'::comp_kind])
                    AND c.sf IS NOT NULL AND c.sf > 300 AND p.property_type IS NOT NULL) q
          WHERE q.ly IS NOT NULL AND q.lx IS NOT NULL
          GROUP BY q.ptype, q.dt
         HAVING count(*) >= 30
        ), elast_land AS (
         SELECT GREATEST('-0.8'::numeric::double precision, LEAST(0::double precision, COALESCE(regr_slope(q.ly::double precision, q.lx::double precision), 0::double precision)))::numeric AS b
           FROM ( SELECT ln(c.land_acres::numeric) AS lx,
                    ln(NULLIF(COALESCE(c.price_per_acre,
                        CASE
                            WHEN c.land_acres > 0::numeric THEN c.sale_price / c.land_acres
                            ELSE NULL::numeric
                        END), 0::numeric)) AS ly
                   FROM comps c
                     JOIN properties p ON p.id = c.property_id
                  WHERE c.kind = ANY (ARRAY['asking'::comp_kind, 'executed'::comp_kind])
                    AND c.deal_type = 'sale'::deal_type AND p.property_type::text = 'land'::text AND c.land_acres > 0.05) q
          WHERE q.ly IS NOT NULL AND q.lx IS NOT NULL
        ), ref AS (
         SELECT p.id,
            p.county,
            p.property_type::text AS ptype,
            p.gross_sf::numeric AS bsf,
            p.land_acres,
            cal.asking_lease_rate_psf AS lease_psf,
            COALESCE(cal.sf, p.gross_sf)::numeric AS lease_sf,
                CASE
                    WHEN cas.sale_price IS NOT NULL AND COALESCE(cas.sf, p.gross_sf) > 0 THEN round(cas.sale_price / COALESCE(cas.sf, p.gross_sf)::numeric, 2)
                    ELSE NULL::numeric
                END AS sale_psf,
            COALESCE(cas.sf, p.gross_sf)::numeric AS sale_sf,
                CASE
                    WHEN cas.sale_price IS NOT NULL AND p.land_acres > 0::numeric AND p.property_type::text = 'land'::text THEN round(cas.sale_price / p.land_acres, 0)
                    ELSE NULL::numeric
                END AS land_ppa
           FROM properties p
             LEFT JOIN v_property_current_asking cal ON cal.property_id = p.id AND cal.deal_type = 'lease'::deal_type
             LEFT JOIN v_property_current_asking cas ON cas.property_id = p.id AND cas.deal_type = 'sale'::deal_type
          WHERE p.county IS NOT NULL
        ), lease_t AS (
         SELECT ref.ptype,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (ref.lease_psf::double precision))::numeric AS m,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (ref.lease_sf::double precision))::numeric AS s,
            count(*) AS n
           FROM ref
          WHERE ref.lease_psf > 0::numeric AND ref.lease_sf > 0::numeric
          GROUP BY ref.ptype
        ), sale_t AS (
         SELECT ref.ptype,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (ref.sale_psf::double precision))::numeric AS m,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (ref.sale_sf::double precision))::numeric AS s,
            count(*) AS n
           FROM ref
          WHERE ref.sale_psf > 0::numeric AND ref.sale_sf > 0::numeric
          GROUP BY ref.ptype
        ), land_t AS (
         SELECT percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (ref.land_ppa::double precision))::numeric AS m,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (ref.land_acres::double precision))::numeric AS s,
            count(*) AS n
           FROM ref
          WHERE ref.land_ppa > 0::numeric AND ref.land_acres > 0::numeric
        ), lease_ct AS (
         SELECT ref.county,
            ref.ptype,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (ref.lease_psf::double precision))::numeric AS m,
            count(*) AS n
           FROM ref
          WHERE ref.lease_psf > 0::numeric
          GROUP BY ref.county, ref.ptype
        ), sale_ct AS (
         SELECT ref.county,
            ref.ptype,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (ref.sale_psf::double precision))::numeric AS m,
            count(*) AS n
           FROM ref
          WHERE ref.sale_psf > 0::numeric
          GROUP BY ref.county, ref.ptype
        ), land_c AS (
         SELECT ref.county,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (ref.land_ppa::double precision))::numeric AS m,
            count(*) AS n
           FROM ref
          WHERE ref.land_ppa > 0::numeric
          GROUP BY ref.county
        ), expected AS (
         SELECT r.id,
            r.county,
            r.ptype,
            r.bsf,
            r.land_acres,
            r.lease_psf,
            r.sale_psf,
            r.land_ppa,
            lt.n AS lease_n,
            st.n AS sale_n,
            landt.n AS land_n,
                CASE
                    WHEN lt.m > 0::numeric AND r.lease_sf > 0::numeric AND lt.s > 0::numeric THEN lt.m *
                    CASE
                        WHEN lct.n >= 5 AND lt.m > 0::numeric THEN LEAST(2.0, GREATEST(0.5, lct.m / lt.m))
                        ELSE 1::numeric
                    END * power(r.lease_sf / lt.s, COALESCE(elb_l.b, 0::numeric))
                    ELSE NULL::numeric
                END AS exp_lease,
                CASE
                    WHEN st.m > 0::numeric AND r.sale_sf > 0::numeric AND st.s > 0::numeric THEN st.m *
                    CASE
                        WHEN sct.n >= 5 AND st.m > 0::numeric THEN LEAST(2.0, GREATEST(0.5, sct.m / st.m))
                        ELSE 1::numeric
                    END * power(r.sale_sf / st.s, COALESCE(elb_s.b, 0::numeric))
                    ELSE NULL::numeric
                END AS exp_sale,
                CASE
                    WHEN landt.m > 0::numeric AND r.land_acres > 0::numeric AND landt.s > 0::numeric THEN landt.m *
                    CASE
                        WHEN lc.n >= 5 AND landt.m > 0::numeric THEN LEAST(2.0, GREATEST(0.5, lc.m / landt.m))
                        ELSE 1::numeric
                    END * power(r.land_acres / landt.s, COALESCE(el.b, 0::numeric))
                    ELSE NULL::numeric
                END AS exp_land,
            r.land_acres IS NULL OR r.land_acres <= 0::numeric OR r.bsf IS NULL OR (r.bsf / (r.land_acres * 43560::numeric)) >= 0.03 AS real_building
           FROM ref r
             LEFT JOIN lease_t lt ON lt.ptype = r.ptype
             LEFT JOIN lease_ct lct ON lct.county = r.county AND lct.ptype = r.ptype
             LEFT JOIN elast_bldg elb_l ON elb_l.ptype = r.ptype AND elb_l.dt = 'lease'::text
             LEFT JOIN sale_t st ON st.ptype = r.ptype
             LEFT JOIN sale_ct sct ON sct.county = r.county AND sct.ptype = r.ptype
             LEFT JOIN elast_bldg elb_s ON elb_s.ptype = r.ptype AND elb_s.dt = 'sale'::text
             CROSS JOIN land_t landt
             CROSS JOIN elast_land el
             LEFT JOIN land_c lc ON lc.county = r.county
        )
 SELECT id,
    county,
    ptype AS property_type,
    lease_psf AS asking_rate_psf,
    round(exp_lease, 2) AS lease_baseline_median,
    lease_n AS lease_baseline_n,
        CASE
            WHEN lease_psf > 0::numeric AND ptype IS DISTINCT FROM 'land'::text AND exp_lease > 0::numeric AND lease_n >= 20 THEN round((lease_psf - exp_lease) / exp_lease * 100::numeric, 0)
            ELSE NULL::numeric
        END AS lease_vs_market_pct,
    lease_psf >= 3::numeric AND ptype IS DISTINCT FROM 'land'::text AND exp_lease > 0::numeric AND lease_n >= 20 AND lease_psf <= (exp_lease * 0.75) AND lease_psf >= (exp_lease * 0.45) AS good_lease_deal,
    sale_psf,
    round(exp_sale, 2) AS sale_baseline_median,
    sale_n AS sale_baseline_n,
        CASE
            WHEN sale_psf > 0::numeric AND ptype IS DISTINCT FROM 'land'::text AND exp_sale > 0::numeric AND sale_n >= 20 THEN round((sale_psf - exp_sale) / exp_sale * 100::numeric, 0)
            ELSE NULL::numeric
        END AS sale_vs_market_pct,
    sale_psf >= 15::numeric AND ptype IS DISTINCT FROM 'land'::text AND exp_sale > 0::numeric AND sale_n >= 20 AND real_building AND sale_psf <= (exp_sale * 0.75) AND sale_psf >= (exp_sale * 0.45) AS good_sale_deal,
    land_ppa AS land_per_acre,
    round(exp_land, 0) AS land_baseline_median,
    land_n AS land_baseline_n,
        CASE
            WHEN land_ppa > 0::numeric AND exp_land > 0::numeric AND land_n >= 20 THEN round((land_ppa - exp_land) / exp_land * 100::numeric, 0)
            ELSE NULL::numeric
        END AS land_vs_market_pct,
    land_ppa >= 5000::numeric AND exp_land > 0::numeric AND land_n >= 20 AND land_ppa <= (exp_land * 0.75) AND land_ppa >= (exp_land * 0.45) AS good_land_deal
   FROM expected;
