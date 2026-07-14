-- The sweep narrowed to Hillsborough County only (2026-07-14, Alex's call; now twice
-- weekly Sun+Wed). The off-market finalize must judge ONLY counties the sweep still
-- covers: unscoped, the Hillsborough-only stamp count (~776) vs the old 6-county
-- baseline (1,912) trips the 85% shrink guard every week, silently disabling
-- off-market detection everywhere — and without the guard, the 5 unswept counties'
-- ~1,500 listings would mass-flip off_market simply because we stopped looking.
--
-- The old zero-arg signature is DROPPED (not overloaded): PostgREST would route a
-- body of {} to the zero-arg version and quietly bypass the scoping forever.
-- n8n WF3's finalize node now posts {"p_counties": ["Hillsborough"]}.
-- Unswept counties keep their last stamp + on_market status frozen as of 2026-07-13;
-- re-widening the sweep later = pass their names in p_counties again (and expect one
-- catch-up wave of flips for anything that delisted meanwhile).

drop function if exists public.sweep_finalize_off_market();

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
     and last_seen_in_sweep < current_date
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

-- One-time baseline reset to the new scope: Hillsborough on-market scraped count
-- (776 at cutover). Without this the first scoped run (~700-800 seen) would compare
-- against 1,912 and skip.
update sweep_meta set last_seen_count = 776 where id;
