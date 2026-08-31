-- 0045: market_events — off-market monitoring spine (permits / sales / zoning changes)
-- Sources write via import_market_events(jsonb) only (n8n cursor pulls, Mac diff pushes).
-- Dedupe on (source, source_key); re-sends update detail/last_seen_at, never re-alert.

create type market_event_type as enum ('permit','sale','zoning_change');
create type market_event_status as enum ('new','seen','dismissed');

create table market_events (
  id uuid primary key default gen_random_uuid(),
  event_type market_event_type not null,
  source text not null,
  source_key text not null,
  event_date date,
  property_id uuid references properties(id) on delete set null,
  county text,
  parcel_number text,
  address text,
  city text,
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  url text,
  status market_event_status not null default 'new',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_events_source_key_uniq unique (source, source_key)
);

create index market_events_property_idx on market_events(property_id) where property_id is not null;
create index market_events_new_idx on market_events(status) where status = 'new';
create index market_events_date_idx on market_events(event_date desc);

create trigger market_events_updated_at before update on market_events
  for each row execute function set_updated_at();

alter table market_events enable row level security;

create policy market_events_auth_all on market_events
  for all to authenticated using (true) with check (true);

-- VA silo (house rule: hand-applied restrictive policy on every new table, initplan-wrapped)
create policy market_events_va_deny on market_events
  as restrictive for all to authenticated
  using ((select not is_va())) with check ((select not is_va()));

-- Idempotent ingest door. p = jsonb array of events:
--   {event_type, source, source_key, event_date, county, parcel_number, address, city,
--    title, detail, url}
-- Matches to the book via find_property(parcel, address, city) (folio-aware).
-- Returns {inserted, updated, matched, new_events:[{title, url, event_type, matched}]}
-- so the caller can build a digest without a follow-up read.
create or replace function import_market_events(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  with staged as (
    select distinct on (e->>'source', e->>'source_key')
      (e->>'event_type')::market_event_type as event_type,
      e->>'source' as source,
      e->>'source_key' as source_key,
      nullif(e->>'event_date','')::date as event_date,
      nullif(e->>'county','') as county,
      nullif(e->>'parcel_number','') as parcel_number,
      nullif(trim(regexp_replace(coalesce(e->>'address',''), '\s+', ' ', 'g')),'') as address,
      nullif(e->>'city','') as city,
      left(e->>'title', 300) as title,
      coalesce(e->'detail','{}'::jsonb) as detail,
      nullif(e->>'url','') as url
    from jsonb_array_elements(p) e
    where e->>'source' is not null
      and e->>'source_key' is not null
      and e->>'title' is not null
      and e->>'event_type' is not null
  ),
  matched as (
    select s.*, find_property(s.parcel_number, s.address, s.city) as property_id
    from staged s
  ),
  up as (
    insert into market_events as me
      (event_type, source, source_key, event_date, county, parcel_number,
       address, city, title, detail, url, property_id)
    select event_type, source, source_key, event_date, county, parcel_number,
           address, city, title, detail, url, property_id
    from matched
    on conflict (source, source_key) do update
      set detail       = me.detail || excluded.detail,
          event_date   = coalesce(excluded.event_date, me.event_date),
          property_id  = coalesce(me.property_id, excluded.property_id),
          last_seen_at = now()
    returning (xmax = 0) as is_new, title, url, event_type, property_id
  )
  select jsonb_build_object(
    'inserted', count(*) filter (where is_new),
    'updated',  count(*) filter (where not is_new),
    'matched',  count(*) filter (where is_new and property_id is not null),
    'new_events', coalesce(jsonb_agg(
        jsonb_build_object(
          'title', title, 'url', url, 'event_type', event_type,
          'matched', property_id is not null, 'property_id', property_id
        ) order by property_id is not null desc
      ) filter (where is_new), '[]'::jsonb)
  ) into v_result
  from up;

  return coalesce(v_result, jsonb_build_object('inserted',0,'updated',0,'matched',0,'new_events','[]'::jsonb));
end $$;

revoke all on function import_market_events(jsonb) from public, anon;
grant execute on function import_market_events(jsonb) to authenticated, service_role;
