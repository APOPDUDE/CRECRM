-- Applied 2026-08-24 via MCP.
--
-- Typeahead for the War Room search box (Alex: "autofills based on what we are
-- typing", Google-Maps style). search_properties stays the COMMITTED search —
-- thorough (owner/tenant/parcel unions) and ~900ms; suggestions need <100ms at
-- 8 rows, so this is its lean sibling: address-prefix first (btree — search_text
-- begins with the normalized address), bounded infix as the fallback for
-- city/owner mid-string matches. Measured 60ms.

begin;

create index if not exists properties_search_text_prefix_idx
  on properties (search_text text_pattern_ops);

comment on index properties_search_text_prefix_idx is
  'Prefix arm of suggest_properties: LIKE ''typed%'' as a btree range scan.';

create or replace function suggest_properties(p_query text, p_limit int default 8)
returns table(id uuid, address text, city text, county text)
language sql
stable
set search_path to 'public'
as $$
  with q as (select normalize_address_text(p_query) as tq),
  pre as (
    select p.id, coalesce(p.site_address, p.address) as address, p.city, p.county,
           0 as rank, p.search_text
    from properties p, q
    where q.tq <> '' and p.search_text like q.tq || '%'
      and p.address not ilike '%unavailable%'
      and p.address not ilike 'Portfolio of %'
    order by p.search_text
    limit greatest(coalesce(p_limit, 8), 1)
  ),
  infix as (
    select p.id, coalesce(p.site_address, p.address) as address, p.city, p.county,
           1 as rank, p.search_text
    from properties p, q
    where q.tq <> '' and length(q.tq) >= 4
      and p.search_text like '%' || q.tq || '%'
      and p.address not ilike '%unavailable%'
      and p.address not ilike 'Portfolio of %'
      and not exists (select 1 from pre where pre.id = p.id)
    limit greatest(coalesce(p_limit, 8), 1)
  )
  select id, address, city, county
  from (select * from pre union all select * from infix) u
  order by rank, search_text
  limit greatest(coalesce(p_limit, 8), 1);
$$;

comment on function suggest_properties(text, int) is
  'Search-box typeahead: top-N address suggestions, prefix matches first (btree) then '
  'infix. Deliberately shallow — the committed search (search_properties) stays the '
  'thorough one.';

revoke all on function suggest_properties(text, int) from public, anon;
grant execute on function suggest_properties(text, int) to authenticated, service_role;

commit;
