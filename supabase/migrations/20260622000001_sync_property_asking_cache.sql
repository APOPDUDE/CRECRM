-- Replaces risky Phase E/H: instead of repointing matching + market views onto a
-- view (silent-failure-prone) and dropping columns, keep properties.asking_rate_psf /
-- asking_price / cap_rate_pct as an AUTO-MAINTAINED "current asking" cache. A trigger
-- recomputes them from the latest asking comp whenever any asking comp is inserted,
-- updated, or deleted. The broker edits comps; the cache (and therefore matching,
-- county views, cards, and the generated all_in_monthly_rent) stays correct and fast.
create index if not exists comps_property_kind_idx on public.comps (property_id, kind);

create or replace function public.sync_property_asking_cache()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_pid uuid; v_kind text;
begin
  if tg_op = 'DELETE' then v_pid := old.property_id; v_kind := old.kind;
  else v_pid := new.property_id; v_kind := new.kind; end if;

  if v_pid is not null and v_kind = 'asking' then
    update properties p set
      asking_rate_psf = (
        select c.asking_lease_rate_psf from comps c
        where c.property_id = v_pid and c.kind = 'asking' and c.deal_type = 'lease'
        order by c.as_of_date desc nulls last, c.created_at desc limit 1),
      asking_price = (
        select c.sale_price from comps c
        where c.property_id = v_pid and c.kind = 'asking' and c.deal_type = 'sale'
        order by c.as_of_date desc nulls last, c.created_at desc limit 1),
      cap_rate_pct = (
        select c.cap_rate_pct from comps c
        where c.property_id = v_pid and c.kind = 'asking'
        order by c.as_of_date desc nulls last, c.created_at desc limit 1),
      updated_at = now()
    where p.id = v_pid;
  end if;
  return null;
end $$;

drop trigger if exists comps_sync_asking_cache on public.comps;
create trigger comps_sync_asking_cache
  after insert or update or delete on public.comps
  for each row execute function public.sync_property_asking_cache();
