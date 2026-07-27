-- Manual card ordering on the boards.
--
-- Cards sorted by created_at, so the only way to arrange a column was to rewrite
-- created_at (which is what the "group by listing agent" pass did -- a hack on a system
-- column). A real ordering key replaces that.
--
-- double precision, not integer, so a card dropped between two neighbours is ONE update
-- to the midpoint rather than renumbering the whole column.

alter table pursuits add column sort_order double precision;

-- Backfill as a single global sequence matching today's ordering (created_at DESC).
-- Because it is one consistent sequence, the relative order inside EVERY board -- a
-- client's list and a property's list alike -- is preserved exactly as it looks now.
with ordered as (
  select id, row_number() over (order by created_at desc, id) * 1000.0 as pos
  from pursuits
)
update pursuits p set sort_order = o.pos from ordered o where o.id = p.id;

alter table pursuits alter column sort_order set not null;

-- New pursuits land at the top of their column (lowest sort_order wins).
create or replace function pursuits_default_sort_order()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.sort_order is null then
    select coalesce(min(sort_order), 1000.0) - 1000.0 into new.sort_order from pursuits;
  end if;
  return new;
end $$;

create trigger pursuits_sort_order_default
  before insert on pursuits
  for each row execute function pursuits_default_sort_order();

create index pursuits_sort_order_idx on pursuits (sort_order);
