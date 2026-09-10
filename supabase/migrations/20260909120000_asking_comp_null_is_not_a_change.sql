-- import_scraped_listings: a scrape with no rate/price/cap is NO INFORMATION, not a change.
--
-- The change test was `last_rate is distinct from new_rate` (same for price and cap), so a
-- pass where the actor returned "Upon Request" / dropped the rate appended a null comp and
-- the next priced pass appended the same price again. Measured 2026-09-07 over 9,382
-- scrape asking comps ordered per source_key: 1,313 priced->null, 1,005 null->priced
-- (same price), 387 exact repeats, 269 real price changes. 2026-08-26 alone minted 2,460
-- rows, 1,924 of them unpriced. 11881 N 44th St carried 5 rows for 2 sets of terms.
--
-- New rule (Alex 2026-09-07: a new comp only when the price changes or it is a different
-- unit):
--   * no information in this pass            -> touch the latest row, never append
--   * latest row is itself unpriced          -> fill it in place, never append
--   * a KNOWN value differs from a KNOWN one -> append (real change)
--   * the advertised space changed between two real space figures -> append (new unit);
--     sf merely falling back to the building SF is not a unit change
--   * otherwise                              -> update the latest row in place
-- The in-place branch now also carries rate/price/cap forward (fill) and keeps a real
-- space figure over the building fallback so `sf` cannot flap either.
--
-- Patched in place off the LIVE definition (same pattern as 20260905030000) — every anchor
-- is asserted to occur exactly once, so a drifted body fails loudly instead of half-applying.
create function pg_temp.patch_once(d text, anchor text, repl text) returns text
language plpgsql as $f$
declare c int;
begin
  c := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
  if c <> 1 then raise exception 'import_scraped_listings: anchor % found % times', left(anchor, 60), c; end if;
  return replace(d, anchor, repl);
end $f$;

do $$
declare def text; a text; b text;
begin
  def := pg_get_functiondef('public.import_scraped_listings(jsonb,uuid,boolean)'::regprocedure);

  -- 1. declarations
  def := pg_temp.patch_once(def,
    'v_last_id uuid; v_last_rate numeric; v_last_price numeric; v_last_cap numeric;',
    'v_last_id uuid; v_last_rate numeric; v_last_price numeric; v_last_cap numeric; v_last_sf int; v_has_info boolean;');

  -- 2. read the latest row's sf too
  def := pg_temp.patch_once(def,
    E'select id, asking_lease_rate_psf, sale_price, cap_rate_pct, asking_lease_rate_psf_max\ninto v_last_id, v_last_rate, v_last_price, v_last_cap, v_last_rate_max\n',
    E'select id, asking_lease_rate_psf, sale_price, cap_rate_pct, asking_lease_rate_psf_max, sf\ninto v_last_id, v_last_rate, v_last_price, v_last_cap, v_last_rate_max, v_last_sf\n');

  -- 3. the change test
  a := E'if v_last_id is null\nor v_last_rate is distinct from v_rate\nor v_last_price is distinct from v_price_for_comp\nor v_last_cap is distinct from v_cap\nor (v_rate_max is not null and v_last_rate_max is distinct from v_rate_max) then\n';
  b := E'-- 2026-09-09: null = no information, never a change (migration 20260909120000).\n'
    || E'v_has_info := v_rate is not null or v_price_for_comp is not null or v_cap is not null;\n'
    || E'if v_last_id is null\n'
    || E'or (v_has_info\n'
    || E'    and (v_last_rate is not null or v_last_price is not null or v_last_cap is not null)\n'
    || E'    and (   (v_rate is not null and v_last_rate is not null and v_rate <> v_last_rate)\n'
    || E'         or (v_price_for_comp is not null and v_last_price is not null and v_price_for_comp <> v_last_price)\n'
    || E'         or (v_cap is not null and v_last_cap is not null and v_cap <> v_last_cap)\n'
    || E'         or (v_rate_max is not null and v_last_rate_max is not null and v_rate_max <> v_last_rate_max)\n'
    || E'         or (v_space is not null and v_last_sf is not null and v_space <> v_last_sf\n'
    || E'             and v_last_sf is distinct from v_building))) then\n';
  def := pg_temp.patch_once(def, a, b);

  -- 4. the in-place branch: fill known values forward, never let sf fall back to the shell
  def := pg_temp.patch_once(def,
    E'update comps set sf = coalesce(v_sf, sf),\n',
    E'update comps set sf = case when v_ml_type = ''lease'' then coalesce(v_space, sf, v_sf) else coalesce(v_sf, sf) end,\n'
    || E'asking_lease_rate_psf = coalesce(v_rate, asking_lease_rate_psf),\n'
    || E'sale_price = coalesce(v_price_for_comp, sale_price),\n'
    || E'cap_rate_pct = coalesce(v_cap, cap_rate_pct),\n');

  execute def;
end $$;

drop function pg_temp.patch_once(text, text, text);
