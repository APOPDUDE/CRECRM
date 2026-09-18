-- Funnel analytics: every screen a visitor sees and every button they press on
-- alexpoplawski.com, whether or not they ever finish. Without this we only ever see the
-- people who completed, which says nothing about where everyone else gave up.
--
-- Applied to production in three steps (funnel_events, resolve-track, client-time); this
-- file is the settled result.

create table if not exists public.funnel_events (
  id bigint generated always as identity primary key,
  session_id text not null,
  form text not null,
  track text,
  step text not null,
  event text not null check (event in ('view', 'choice', 'next', 'back', 'submit', 'book', 'abandon')),
  value text,
  step_index int,
  page text,
  referrer text,
  channel text,
  occurred_at timestamptz not null default now()
);

create index if not exists funnel_events_session_idx on public.funnel_events (session_id, occurred_at);
create index if not exists funnel_events_step_idx on public.funnel_events (form, step, occurred_at desc);
create index if not exists funnel_events_time_idx on public.funnel_events (occurred_at desc);

alter table public.funnel_events enable row level security;
drop policy if exists funnel_events_auth_read on public.funnel_events;
create policy funnel_events_auth_read on public.funnel_events for select to authenticated using (true);

-- The site is static and holds no credentials, so it beacons batches to n8n
-- (workflow ELPuuno4inyKLK59), which calls this with the service role.
create or replace function public.record_funnel_events(p jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  insert into public.funnel_events (session_id, form, track, step, event, value, step_index, page, referrer, channel, occurred_at)
  select
    left(coalesce(e ->> 'session_id', ''), 64),
    left(coalesce(e ->> 'form', 'unknown'), 32),
    left(nullif(e ->> 'track', ''), 32),
    left(coalesce(e ->> 'step', 'unknown'), 64),
    coalesce(e ->> 'event', 'view'),
    left(nullif(e ->> 'value', ''), 300),
    nullif(e ->> 'step_index', '')::int,
    left(nullif(e ->> 'page', ''), 500),
    left(nullif(e ->> 'referrer', ''), 500),
    left(nullif(e ->> 'channel', ''), 40),
    -- Trust the client's clock, bounded: events ship in batches, so insert time would give
    -- a whole batch one timestamp and we could no longer tell which screen came last.
    case
      when (e ->> 'at') is null then now()
      when (e ->> 'at')::timestamptz between now() - interval '2 days' and now() + interval '1 hour'
        then (e ->> 'at')::timestamptz
      else now()
    end
  from jsonb_array_elements(coalesce(p -> 'events', '[]'::jsonb)) as e
  where coalesce(e ->> 'session_id', '') <> ''
    and coalesce(e ->> 'event', 'view') in ('view', 'choice', 'next', 'back', 'submit', 'book', 'abandon');
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.record_funnel_events(jsonb) from public, anon, authenticated;
grant execute on function public.record_funnel_events(jsonb) to service_role;

-- Drop-off per step. A session carries no track until the visitor picks one, so each
-- session is resolved to the track it ended on; the ones who quit before choosing are
-- filed under 'undecided' rather than double-counted across both.
drop view if exists public.v_funnel_dropoff;

create view public.v_funnel_dropoff
with (security_invoker = true)
as
with session_track as (
  select session_id,
         coalesce(max(track) filter (where track is not null), 'undecided') as track,
         min(form) as form
  from public.funnel_events
  group by session_id
),
ev as (
  select e.*, st.track as res_track
  from public.funnel_events e
  join session_track st on st.session_id = e.session_id
),
seen as (
  select form, res_track as track, step,
         min(step_index) as step_index,
         count(distinct session_id) as sessions,
         max(occurred_at) as last_seen
  from ev
  where event = 'view'
  group by 1, 2, 3
),
finished as (
  select distinct session_id from public.funnel_events where event in ('book', 'submit')
),
left_here as (
  select form, track, step, count(*) as dropped
  from (
    select distinct on (e.session_id) e.session_id, e.form, e.res_track as track, e.step
    from ev e
    where e.event = 'view' and e.session_id not in (select session_id from finished)
    -- id breaks ties inside one batch: it preserves the order the client queued them.
    order by e.session_id, e.occurred_at desc, e.id desc
  ) last_step
  group by 1, 2, 3
)
select s.form, s.track, s.step, s.step_index, s.sessions,
       coalesce(l.dropped, 0) as dropped_here,
       round(100.0 * coalesce(l.dropped, 0) / nullif(s.sessions, 0), 1) as drop_pct,
       s.last_seen
from seen s
left join left_here l on l.form = s.form and l.track = s.track and l.step = s.step
order by s.form, s.track, s.step_index nulls last;

grant select on public.v_funnel_dropoff to authenticated, service_role;
