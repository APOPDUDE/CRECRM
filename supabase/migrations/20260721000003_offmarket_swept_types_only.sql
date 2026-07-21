-- Off-market finalize was flipping properties the sweep can no longer see.
--
-- The sweep is now industrial-only (industrial + industrial-ish land). But
-- sweep_finalize_off_market marked ANY scraped on-market property in the swept counties
-- off_market if it wasn't seen in 7 days — including office/retail/other rows imported by the
-- earlier all-types sweep, which the industrial-only sweep will NEVER re-see. So they all aged
-- out to off_market even while still live on LoopNet (e.g. 13120 Pritchart Rd, Parrish).
--
-- Fix: only off-market the property types the sweep actually covers (industrial, land). Other
-- types are left frozen at whatever status they had — we no longer track them. The seen-count
-- floor/shrink guard is likewise scoped to the swept types so it reflects real coverage.

create or replace function public.sweep_finalize_off_market(p_counties text[] default null::text[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_seen int;
  v_prev int;
  v_off  int := 0;
begin
  select count(*) into v_seen from properties
   where last_seen_in_sweep >= current_date
     and property_type::text in ('industrial', 'land')
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
     and property_type::text in ('industrial', 'land')   -- only the types the sweep re-sees
     and last_seen_in_sweep is not null
     and last_seen_in_sweep < current_date - 7
     and listing_status = 'on_market'
     and (p_counties is null or county = any(p_counties));
  get diagnostics v_off = row_count;

  insert into sweep_meta (id, last_seen_count, last_run_at)
  values (true, v_seen, now())
  on conflict (id) do update set last_seen_count = excluded.last_seen_count,
                                 last_run_at = excluded.last_run_at;

  return jsonb_build_object('seen', v_seen, 'prev', v_prev, 'marked_off_market', v_off,
                            'counties', p_counties);
end $function$;
