-- Off-market detection under the SPLIT weekly sweep (one Apify run per county).
--
-- The old sweep_mark_off_market(p_seen uuid[]) assumed ONE run covered the whole market:
-- "absent from this run's ids" meant off-market. With six per-county runs, each run only
-- sees its own slice, so that assumption would flip the other five counties off. Split
-- the job in two:
--   1. sweep_stamp_seen(uuid[])      -- per run: stamp last_seen_in_sweep + reactivate
--                                       anything seen that had been flipped off.
--   2. sweep_finalize_off_market()   -- once, after all runs (Sun ~12:00 ET n8n schedule):
--                                       flip scraped LoopNet-side properties that were
--                                       covered before but NOT stamped today.
-- Guards on finalize: hard floor of 300 stamped-today, and >=85% of the last trusted
-- sweep size — one failed county run (~17% of inventory) correctly skips that week's
-- flips instead of flipping a whole county off. Crexi-keyed rows are excluded from the
-- LoopNet diff (their own detection can come later).
-- The old sweep_mark_off_market is kept (unused) as a rollback path; WF3 now calls
-- sweep_stamp_seen per run and sweep_finalize_off_market on the Sunday schedule.

create or replace function public.sweep_stamp_seen(p_seen_property_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_seen int := coalesce(array_length(p_seen_property_ids,1),0);
  v_back int := 0;
begin
  if v_seen = 0 then
    return jsonb_build_object('seen', 0, 'reactivated', 0);
  end if;

  -- A listing seen in this run is on the market again, whatever the diff said before.
  update properties
     set listing_status = 'on_market', updated_at = now()
   where id = any(p_seen_property_ids)
     and listing_status = 'off_market';
  get diagnostics v_back = row_count;

  update properties
     set last_seen_in_sweep = now()
   where id = any(p_seen_property_ids);

  return jsonb_build_object('seen', v_seen, 'reactivated', v_back);
end $$;

create or replace function public.sweep_finalize_off_market()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_seen int;
  v_prev int;
  v_off  int := 0;
begin
  -- Everything any of today's county runs stamped (runs 06:00-08:00 ET = 10:00-12:00 UTC,
  -- finalize 12:00 ET = 16:00 UTC, same UTC date).
  select count(*) into v_seen from properties where last_seen_in_sweep >= current_date;
  select last_seen_count into v_prev from sweep_meta where id;

  -- Hard floor: never diff against a tiny set (misfire / most runs failed).
  if v_seen < 300 then
    return jsonb_build_object('skipped', true, 'reason', 'seen_below_floor', 'seen', v_seen);
  end if;

  -- Shrink guard at 85%: one missing county (~17% of inventory) skips this week's flips
  -- rather than flipping that county off. Baseline stays at the last trusted count.
  if v_prev is not null and v_seen < (v_prev * 0.85) then
    update sweep_meta set last_run_at = now() where id;
    return jsonb_build_object('skipped', true, 'reason', 'sweep_shrank', 'seen', v_seen, 'prev', v_prev);
  end if;

  -- Flip: LoopNet-side scraped inventory covered before but not stamped today.
  update properties
     set listing_status = 'off_market', updated_at = now()
   where source = 'scrape'
     and coalesce(source_key,'') not like 'crexi:%'
     and last_seen_in_sweep is not null
     and last_seen_in_sweep < current_date
     and listing_status = 'on_market';
  get diagnostics v_off = row_count;

  insert into sweep_meta (id, last_seen_count, last_run_at)
  values (true, v_seen, now())
  on conflict (id) do update set last_seen_count = excluded.last_seen_count,
                                 last_run_at = excluded.last_run_at;

  return jsonb_build_object('seen', v_seen, 'prev', v_prev, 'marked_off_market', v_off);
end $$;

grant execute on function public.sweep_stamp_seen(uuid[]) to authenticated, service_role;
revoke execute on function public.sweep_stamp_seen(uuid[]) from anon, public;
grant execute on function public.sweep_finalize_off_market() to authenticated, service_role;
revoke execute on function public.sweep_finalize_off_market() from anon, public;
