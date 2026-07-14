-- Refresh match suggestions on demand: cross-reference recent on-market scraped
-- listings against the searching-client pool. The matching rules live entirely in
-- cross_reference; this wrapper just picks the property window so the app's
-- "Find new matches" button and automations share one entry point.
--
-- Windowing on created_at is deliberate: scraped_at is re-stamped for EVERY property
-- seen by a sweep (~1,900 in 14 days vs ~850 truly new), so widening to it would let
-- one button tap suggest the whole active inventory. The cost: a property that
-- re-lists under its old row is missed HERE, but the weekly n8n path passes each
-- import batch's actual ids to cross_reference, which does catch it.
create or replace function public.refresh_suggestions(p_days integer default 14)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  select cross_reference(coalesce(array_agg(id), '{}'::uuid[]))
  from properties
  where source = 'scrape'
    and listing_status = 'on_market'
    and created_at > now() - make_interval(days => greatest(p_days, 1));
$$;

grant execute on function public.refresh_suggestions(integer) to authenticated, service_role;
revoke execute on function public.refresh_suggestions(integer) from anon, public;
