-- War Room Signals lens (2026-09-05): the properties behind a list of ids, in the SAME
-- shape map_properties() / search_map_properties() return (list-slice property + owner
-- context), so the page can plot a set Postgres already picked — the properties that
-- carry market_events — without downloading the book. SECURITY DEFINER for the same
-- reason the map RPC is (RLS defeats every numeric index); is_va() re-asserted by hand.
create or replace function public.map_properties_by_ids(p_ids uuid[])
returns table(property jsonb, owner_ctx jsonb, total_in_view bigint)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if public.is_va() then
    raise insufficient_privilege using message = 'map_properties_by_ids: denied to the VA role';
  end if;
  return query
  with ids as materialized (
    select distinct x as id from unnest(coalesce(p_ids, '{}'::uuid[])) as x
  )
  select to_jsonb(v), to_jsonb(ctx), (select count(*) from ids)
  from ids i
  join public.v_map_property v on v.id = i.id
  left join public.v_property_owner_context ctx on ctx.property_id = i.id;
end $$;

revoke execute on function public.map_properties_by_ids(uuid[]) from public, anon;
grant execute on function public.map_properties_by_ids(uuid[]) to authenticated, service_role;
