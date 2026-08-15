-- Audit item 3 / R7 groundwork: a county deed transfer is a comp kind of its own —
-- real event, possibly non-arm's-length, $0 allowed, EXCLUDED from valuation by default.
-- ADDITIVE ONLY (two-migration rule): no row carries it yet. The last_sale_* backfill and the
-- import_county_parcels repoint come in a later migration, and are BLOCKED until these five views
-- gain explicit kind guards (they read comps without filtering kind):
--   v_property_market_position, v_comp_size_elasticity, v_county_land_metrics,
--   v_excess_land_decay, v_comp_class_premium
alter type comp_kind add value if not exists 'transfer';
