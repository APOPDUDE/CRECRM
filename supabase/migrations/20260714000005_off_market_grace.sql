-- Off-market false positives (Alex confirmed many "off-market" properties are still
-- listed). Root cause: the finalize flipped anything unseen by the CURRENT day's sweep
-- (last_seen_in_sweep < current_date), so one truncated run mass-flips everything it
-- missed. Evidence from the Jul-13 wave (612 flips): the Pinellas run returned only
-- 178 items (vs Pasco 511) and 208 Pinellas rows were flipped — more than the 198
-- still on-market there. The global 85% shrink guard can't catch per-county truncation.
--
-- Fix 1 — grace period: flip only when unseen for MORE than 7 days, i.e. missed at
-- least two consecutive runs at the Sun+Wed cadence. A single erratic/truncated run
-- can no longer flip anything.
create or replace function public.sweep_finalize_off_market(p_counties text[] default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_seen int;
  v_prev int;
  v_off  int := 0;
begin
  select count(*) into v_seen from properties
   where last_seen_in_sweep >= current_date
     and (p_counties is null or county = any(p_counties));
  select last_seen_count into v_prev from sweep_meta where id;

  if v_seen < 300 then
    return jsonb_build_object('skipped', true, 'reason', 'seen_below_floor', 'seen', v_seen);
  end if;

  if v_prev is not null and v_seen < (v_prev * 0.85) then
    update sweep_meta set last_run_at = now() where id;
    return jsonb_build_object('skipped', true, 'reason', 'sweep_shrank', 'seen', v_seen, 'prev', v_prev);
  end if;

  update properties
     set listing_status = 'off_market', updated_at = now()
   where source = 'scrape'
     and coalesce(source_key,'') not like 'crexi:%'
     and last_seen_in_sweep is not null
     and last_seen_in_sweep < current_date - 7  -- grace: unseen for 2+ consecutive sweeps
     and listing_status = 'on_market'
     and (p_counties is null or county = any(p_counties));
  get diagnostics v_off = row_count;

  insert into sweep_meta (id, last_seen_count, last_run_at)
  values (true, v_seen, now())
  on conflict (id) do update set last_seen_count = excluded.last_seen_count,
                                 last_run_at = excluded.last_run_at;

  return jsonb_build_object('seen', v_seen, 'prev', v_prev, 'marked_off_market', v_off,
                            'counties', p_counties);
end $$;

grant execute on function public.sweep_finalize_off_market(text[]) to authenticated, service_role;
revoke execute on function public.sweep_finalize_off_market(text[]) from anon, public;

-- Fix 2 — revert the Jul-13 wave. Hillsborough rows re-derive their real status from
-- the live Sun+Wed sweeps (genuinely delisted ones re-flip at the Jul-19 finalize once
-- unseen past the grace window); the other counties are frozen since Jul 13, so they
-- return to their pre-wave status rather than carrying unverifiable flips.
update properties
   set listing_status = 'on_market', updated_at = now()
 where listing_status = 'off_market'
   and updated_at::date = '2026-07-13';
