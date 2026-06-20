-- Off-market detection via weekly-sweep diff.
--
-- The weekly FL sweep (Apify task y1AIrIDEUY635m9RH -> WF3 cre-sweep-ingest) is the
-- ONLY caller of sweep_mark_off_market, so the set of properties it has ever covered
-- (last_seen_in_sweep IS NOT NULL) defines the in-scope inventory. A scraped property
-- the sweep covered before but that is ABSENT from the latest sweep is flipped to
-- off_market; one that reappears is flipped back to on_market.
--
-- Two safety ratchets guard against a partially-failed / empty sweep flipping the whole
-- inventory off-market: a hard floor (>=50 listings) and a shrink guard (>=60% of the
-- last trusted sweep size). The transactionTrackingMode experiment was dropped in favour
-- of this diff (see context/decisions.md 2026-06-20).

alter table public.properties
  add column if not exists last_seen_in_sweep timestamptz;

-- Singleton row holding the last trusted sweep size (for the shrink guard).
create table if not exists public.sweep_meta (
  id boolean primary key default true,
  last_seen_count int,
  last_run_at timestamptz,
  constraint sweep_meta_singleton check (id)
);

create or replace function public.sweep_mark_off_market(p_seen_property_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_seen int := coalesce(array_length(p_seen_property_ids,1),0);
  v_prev int;
  v_off  int := 0;
  v_back int := 0;
begin
  select last_seen_count into v_prev from sweep_meta where id;

  -- Hard floor: never diff against a tiny/empty set (errored sweep, manual misfire).
  if v_seen < 50 then
    return jsonb_build_object('skipped', true, 'reason', 'seen_below_floor', 'seen', v_seen);
  end if;

  -- Shrink guard: a sweep <60% of the last trusted size is treated as a partial
  -- failure. Refresh last_seen for what we did get, but do NOT flip anything off;
  -- keep the prior trusted count as the baseline so a recovery next week is measured
  -- against a real number.
  if v_prev is not null and v_seen < (v_prev * 0.6) then
    update properties set last_seen_in_sweep = now()
     where id = any(p_seen_property_ids);
    update sweep_meta set last_run_at = now() where id;
    return jsonb_build_object('skipped', true, 'reason', 'sweep_shrank',
      'seen', v_seen, 'prev', v_prev);
  end if;

  -- 1) Flip to off_market: scraped, previously-covered, currently on_market, absent now.
  update properties
     set listing_status = 'off_market', updated_at = now()
   where source = 'scrape'
     and last_seen_in_sweep is not null
     and listing_status = 'on_market'
     and id <> all(p_seen_property_ids);
  get diagnostics v_off = row_count;

  -- 2) Reactivate anything in this sweep that had been flipped off.
  update properties
     set listing_status = 'on_market', updated_at = now()
   where id = any(p_seen_property_ids)
     and listing_status = 'off_market';
  get diagnostics v_back = row_count;

  -- 3) Stamp the in-scope set as seen now.
  update properties
     set last_seen_in_sweep = now()
   where id = any(p_seen_property_ids);

  insert into sweep_meta (id, last_seen_count, last_run_at)
  values (true, v_seen, now())
  on conflict (id) do update set last_seen_count = excluded.last_seen_count,
                                 last_run_at = excluded.last_run_at;

  return jsonb_build_object('seen', v_seen, 'marked_off_market', v_off, 'reactivated', v_back);
end $$;

grant execute on function public.sweep_mark_off_market(uuid[]) to anon, authenticated, service_role;

alter table public.sweep_meta enable row level security;
create policy sweep_meta_auth_all on public.sweep_meta for all to authenticated using (true) with check (true);
