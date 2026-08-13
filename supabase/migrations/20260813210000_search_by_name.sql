-- Search a property by the names attached to it: the owning entity, the county's owner of
-- record, the person we skip-traced, the tenant on a lease comp.
--
-- Alex types a name far more often than he types a parcel id — "Procacci", "Grand
-- Preserve" — and until now that returned nothing from the War Room, because search_text
-- only ever held the address.
--
-- Every name here is matched the same way an address already is, and for the same reason:
-- normalizing at query time is what made the original property search take 36 seconds, and
-- the per-row token test costs 330ms on its own over 11k owners. So each name is normalized
-- ON WRITE into a stored column with a trigram index, and each branch anchors on the
-- query's longest word before testing the rest. Measured 2ms.

/**
 * Does every word of the query appear in this text?
 *
 * Whole words, except the last, which matches as a prefix so results appear while the
 * word is still being typed. Substring matching is deliberately NOT used: tokens like "0"
 * or "19" sit inside almost every row, so a query that matches nothing real would still
 * come back full of confident nonsense.
 *
 * Extracted so the address branch and all four name branches cannot drift apart about
 * what "matches" means.
 */
create or replace function name_has_all_tokens(p_text text, p_tokens text[], p_n integer)
returns boolean
language sql
immutable
parallel safe
-- pinned even though this function touches nothing: a mutable search_path on anything
-- callable by `authenticated` is a standing advisory, and it costs nothing to close
set search_path = ''
as $$
  select p_text is not null and p_tokens is not null and not exists (
    select 1
    from unnest(p_tokens) with ordinality as u(tok, ord)
    where case
            when u.ord = p_n then ' ' || p_text not like '% ' || u.tok || '%'
            else ' ' || p_text || ' ' not like '% ' || u.tok || ' %'
          end
  );
$$;

comment on function name_has_all_tokens is
  'Every query word present as a whole word, the last as a prefix. The one definition of a '
  'match, shared by search_properties() address and name branches.';

-- The county's owner of record lives on the property row itself, so it belongs in the
-- haystack that is already built and indexed — no join, no extra scan. A generated column
-- is computed on write and NEVER recomputed, so changing the expression means dropping and
-- re-adding it (which rewrites, and therefore recomputes, every row) and rebuilding the
-- index that hangs off it.
alter table properties drop column search_text;
alter table properties add column search_text text generated always as (
  normalize_address_text(
    coalesce(address, '') || ' ' || coalesce(site_address, '') || ' ' ||
    coalesce(city, '') || ' ' || coalesce(state, '') || ' ' || coalesce(zip, '') || ' ' ||
    coalesce(county, '') || ' ' || coalesce(parcel_number, '') || ' ' ||
    coalesce(folio, '') || ' ' || coalesce(owner_name, '')
  )
) stored;
create index properties_search_text_trgm on properties using gin (search_text gin_trgm_ops);

-- The other names live on their own tables. normalize_owner_name() rather than
-- normalize_address_text(): it canonicalises LLC / INC / LP and strips punctuation, which
-- is what a company name needs, where the address normalizer would fold "Drive" to "dr".
-- owners already carries this column for entity identity; the index is new.
create index if not exists owners_normalized_name_trgm
  on owners using gin (normalized_name gin_trgm_ops);

alter table contacts add column if not exists normalized_name text
  generated always as (
    normalize_owner_name(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
  ) stored;
create index if not exists contacts_normalized_name_trgm
  on contacts using gin (normalized_name gin_trgm_ops);

alter table companies add column if not exists normalized_name text
  generated always as (normalize_owner_name(name)) stored;
create index if not exists companies_normalized_name_trgm
  on companies using gin (normalized_name gin_trgm_ops);

-- 473 lease comps name a tenant with no company row behind them; without this they would
-- be invisible to a search for that tenant.
alter table comps add column if not exists normalized_tenant_name text
  generated always as (normalize_owner_name(tenant_name)) stored;
create index if not exists comps_normalized_tenant_name_trgm
  on comps using gin (normalized_tenant_name gin_trgm_ops);

create or replace function search_properties(p_query text, p_limit integer default 12)
returns table (
  id uuid, address text, source_address text, city text, state text,
  zip text, county text, parcel_number text, folio text
)
language sql
stable
set search_path = public
as $$
  with q as (
    select
      normalize_address_text(p_query) as text_q,
      normalize_owner_name(p_query) as name_q,
      lower(regexp_replace(coalesce(p_query, ''), '[^a-zA-Z0-9]', '', 'g')) as alnum,
      -- the most selective word, so the trigram index does the narrowing before the
      -- per-row token test runs
      (select '%' || tok || '%'
         from unnest(string_to_array(normalize_address_text(p_query), ' ')) tok
        where btrim(tok) <> '' order by length(tok) desc, tok limit 1) as anchor,
      (select '%' || tok || '%'
         from unnest(string_to_array(normalize_owner_name(p_query), ' ')) tok
        where btrim(tok) <> '' order by length(tok) desc, tok limit 1) as name_anchor
  ),
  toks as (
    select array_agg(tok order by ord) as list, count(*)::int as n
    from unnest(string_to_array((select text_q from q), ' ')) with ordinality as t(tok, ord)
    where btrim(tok) <> ''
  ),
  ntoks as (
    select array_agg(tok order by ord) as list, count(*)::int as n
    from unnest(string_to_array((select name_q from q), ' ')) with ordinality as t(tok, ord)
    where btrim(tok) <> ''
  ),
  -- the owning entity as the CRM knows it (the county's spelling is in search_text)
  owner_hit as (
    select o.id from owners o, q, ntoks
    where q.name_anchor is not null
      and o.normalized_name like q.name_anchor
      and name_has_all_tokens(o.normalized_name, ntoks.list, ntoks.n)
  ),
  -- the person behind it: whoever the skip trace attached to that owner
  contact_hit as (
    select oc.owner_id
    from owner_contacts oc join contacts c on c.id = oc.contact_id, q, ntoks
    where q.name_anchor is not null
      and c.normalized_name like q.name_anchor
      and name_has_all_tokens(c.normalized_name, ntoks.list, ntoks.n)
  ),
  company_hit as (
    select co.id from companies co, q, ntoks
    where q.name_anchor is not null
      and co.normalized_name like q.name_anchor
      and name_has_all_tokens(co.normalized_name, ntoks.list, ntoks.n)
  ),
  name_props as (
    select p2.id from properties p2 join owner_hit oh on oh.id = p2.owner_id
    union
    select p2.id from properties p2 join contact_hit ch on ch.owner_id = p2.owner_id
    union
    select cp.property_id from comps cp join company_hit coh on coh.id = cp.tenant_company_id
     where cp.property_id is not null
    union
    select cp.property_id from comps cp, q, ntoks
     where cp.property_id is not null
       and q.name_anchor is not null
       and cp.normalized_tenant_name like q.name_anchor
       and name_has_all_tokens(cp.normalized_tenant_name, ntoks.list, ntoks.n)
  ),
  -- Kept as a UNION rather than folded into one OR: properties rows are wide, and an OR
  -- the planner can't split turns into a seq scan of the whole table (~1s).
  hits as (
    select p1.id
      from properties p1, q, toks
     where q.text_q <> ''
       and (
         -- a parcel id / folio, however it was punctuated
         (length(q.alnum) >= 6 and p1.parcel_key like '%' || q.alnum || '%')
         or (p1.search_text like q.anchor
             and name_has_all_tokens(p1.search_text, toks.list, toks.n))
       )
    union
    select id from name_props
  )
  select p.id,
         coalesce(p.site_address, p.address) as address,
         p.address as source_address,
         p.city, p.state, p.zip, p.county, p.parcel_number, p.folio
  from properties p join hits h on h.id = p.id, q
  where p.address not ilike '%unavailable%'
    and p.address not ilike 'Portfolio of %'
  order by
    case
      when p.search_text = q.text_q then 0
      when p.search_text like q.text_q || '%' then 1
      when position(q.text_q in p.search_text) > 0 then 2
      else 3
    end,
    coalesce(p.site_address, p.address),
    p.id
  limit greatest(coalesce(p_limit, 12), 1);
$$;

comment on function search_properties is
  'The only correct way to let a person find a property by typing: address, city, state, '
  'zip, county, parcel or folio, plus the names attached to it — owning entity, county '
  'owner of record, skip-traced contact, and lease-comp tenant.';
