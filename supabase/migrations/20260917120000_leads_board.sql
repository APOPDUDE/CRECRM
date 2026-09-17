-- Leads board: where a lead sits, and how warm it is.
--
-- The board has two kinds of column. New / Booked / Prep / Met are DERIVED from the
-- Calendly meeting on the lead, so they maintain themselves and are never dragged.
-- Reschedule / Client / Unqualified are decisions, so they are stored. One function
-- decides the answer for both the UI and any automation that asks.

create type public.lead_manual_stage as enum ('reschedule', 'client', 'unqualified');
create type public.lead_temperature as enum ('cold', 'warm', 'hot');

alter table public.prospects
  add column if not exists manual_stage public.lead_manual_stage,
  add column if not exists temperature public.lead_temperature,
  add column if not exists next_action_date date,
  add column if not exists next_action_description text;

create index if not exists prospects_manual_stage_idx on public.prospects (manual_stage);
create index if not exists prospects_next_action_idx on public.prospects (next_action_date)
  where next_action_date is not null;

-- STABLE, not IMMUTABLE: the answer moves with the clock, which is the whole point.
create or replace function public.lead_board_stage(
  p_manual public.lead_manual_stage,
  p_start timestamptz,
  p_cal_status text
) returns text
language sql
stable
as $$
  select case
    when p_manual is not null then p_manual::text
    when p_start is null then 'new'
    when p_cal_status = 'canceled' then 'reschedule'
    when p_start > now() + interval '48 hours' then 'booked'
    when p_start > now() then 'prep'
    else 'met'
  end
$$;

comment on function public.lead_board_stage is
  'Board column for a lead. Manual stage wins; otherwise the meeting date decides (none=new, >48h=booked, <48h=prep, past=met, canceled=reschedule).';

create or replace view public.v_lead_board
with (security_invoker = true)
as
select
  p.id as prospect_id,
  public.lead_board_stage(
    p.manual_stage,
    nullif(p.details -> 'calendly' ->> 'start_time', '')::timestamptz,
    p.details -> 'calendly' ->> 'status'
  ) as stage,
  p.manual_stage,
  p.temperature,
  nullif(p.details -> 'calendly' ->> 'start_time', '')::timestamptz as meeting_at,
  nullif(p.details -> 'calendly' ->> 'end_time', '')::timestamptz as meeting_ends_at,
  p.details -> 'calendly' ->> 'event_name' as meeting_event,
  -- Meeting type comes off the Calendly event name, so it is never typed by hand.
  case
    when p.details -> 'calendly' ->> 'event_name' is null then null
    when p.details -> 'calendly' ->> 'event_name' ilike '%consultation%' then 'consultation'
    when p.details -> 'calendly' ->> 'event_name' ilike '%software%' then 'software'
    else 'space'
  end as meeting_type,
  p.details ->> 'form' as form,
  case
    when p.details ->> 'qualified' = '0' then false
    when p.details ->> 'qualified' = '1' then true
    else null
  end as qualified,
  nullif(p.details ->> 'score', '')::int as score,
  p.next_action_date,
  p.next_action_description
from public.prospects p
where p.status <> 'dead';

comment on view public.v_lead_board is
  'One row per live lead: which board column it belongs in, how warm it is, and the meeting driving it.';

grant select on public.v_lead_board to authenticated, service_role;
