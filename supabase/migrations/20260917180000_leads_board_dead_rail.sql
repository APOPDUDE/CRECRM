-- Dead leads belong on the board too, parked to the LEFT of New behind a collapsed rail
-- (Alex, 2026-09-17): "I don't see them all the time, but I can open it and see the dead
-- ones and move them if I need to." Dead stays on prospects.status — it is the lifecycle
-- the conversion RPC uses — so it simply outranks the derived stage here.

create or replace view public.v_lead_board
with (security_invoker = true)
as
select
  p.id as prospect_id,
  case
    when p.status = 'dead' then 'dead'
    else public.lead_board_stage(
      p.manual_stage,
      nullif(p.details -> 'calendly' ->> 'start_time', '')::timestamptz,
      p.details -> 'calendly' ->> 'status'
    )
  end as stage,
  p.manual_stage,
  p.temperature,
  nullif(p.details -> 'calendly' ->> 'start_time', '')::timestamptz as meeting_at,
  nullif(p.details -> 'calendly' ->> 'end_time', '')::timestamptz as meeting_ends_at,
  p.details -> 'calendly' ->> 'event_name' as meeting_event,
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
  p.next_action_description,
  -- appended last: create-or-replace cannot reorder existing view columns
  p.status
from public.prospects p;

comment on view public.v_lead_board is
  'One row per lead: which board column it belongs in, how warm it is, and the meeting driving it. Dead outranks the derived stage.';

grant select on public.v_lead_board to authenticated, service_role;
