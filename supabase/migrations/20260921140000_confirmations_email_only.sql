-- Frances stops texting (Alex, 2026-09-21): the phone is optional on both Calendly events
-- now, so confirmations are email only. Two steps instead of an email plus two SMS:
--   email1   - a couple of minutes after they book
--   starting - five minutes before the meeting, carrying the Meet link
--
-- n8n `Meeting confirmations (Frances)` (0mCPQ4TMf4YJTNSt) lost every Blooio/GHL node with
-- this: it is now Due now -> Split rows -> Email -> Log -> Stamp, one email per due step.
create or replace function public.due_confirmations()
returns table(step text, task_id uuid, prospect_id uuid, contact_id uuid, ghl_contact_id text,
              first_name text, full_name text, email text, phone text, due_at timestamptz,
              start_long text, start_short text, time_only text, event_name text, join_url text,
              reschedule_url text, summary text, email1_skipped boolean, local_hour integer,
              consult boolean, question text)
language sql security definer set search_path to 'public','pg_temp' as $function$
  with n as (select now() at time zone 'America/New_York' as ts),
  base as (
    select t.id as task_id, t.due_at, t.created_at as booked_at, t.prospect_id, t.contact_id, t.title,
           p.details, p.description, c.first_name, c.last_name, c.email, c.phone, c.ghl_contact_id,
           p.details->'confirmations'->(t.id::text || ':email1') as k_email1,
           p.details->'confirmations'->(t.id::text || ':starting') as k_starting
      from tasks t
      join prospects p on p.id = t.prospect_id
      join contacts c on c.id = t.contact_id
     where t.source = 'calendly' and t.kind = 'meeting' and t.status = 'open' and t.due_at > now()
       and coalesce(p.details->'calendly'->>'status', 'active') = 'active'
       and p.status <> 'dead'
       and nullif(btrim(coalesce(c.email, '')), '') is not null
  ),
  steps as (
    -- Straight after booking. No quiet-hours window any more: the email should land while
    -- they are still on the confirmation page, whatever time it is.
    select 'email1'::text as step, b.* from base b
     where b.k_email1 is null
       and b.booked_at <= now() - interval '2 minutes'
    union all
    -- Five minutes out. The scheduler ticks every 5 min, so the window is six minutes wide to
    -- guarantee exactly one tick lands inside it; `due_at > now()` in base closes it at start.
    select 'starting', b.* from base b
     where b.k_starting is null
       and now() >= b.due_at - interval '6 minutes'
  )
  select s.step, s.task_id, s.prospect_id, s.contact_id, s.ghl_contact_id,
         coalesce(nullif(s.first_name, ''), 'there'),
         btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')),
         s.email, s.phone, s.due_at,
         to_char(s.due_at at time zone 'America/New_York', 'FMDay, Mon FMDD "at" FMHH12:MI AM'),
         to_char(s.due_at at time zone 'America/New_York', 'FMDy FMMM/FMDD "at" FMHH12:MI AM'),
         to_char(s.due_at at time zone 'America/New_York', 'FMHH12:MI AM'),
         coalesce(s.details->'calendly'->>'event_name', '30 Minute Meeting'),
         s.details->'calendly'->>'join_url',
         s.details->'calendly'->>'reschedule_url',
         case when coalesce((s.details->>'calendly_only')::boolean, false) then null
              else coalesce(nullif(s.details->>'summary', ''),
                            case when split_part(coalesce(s.description, ''), E'\n', 2) ~* '^Booked a ' then null
                                 else nullif(split_part(coalesce(s.description, ''), E'\n', 2), '') end) end,
         coalesce((s.k_email1->>'skipped')::boolean, false),
         extract(hour from n.ts)::int,
         (s.title ilike 'Consultation%' or coalesce(s.details->>'form', '') = 'consultation'),
         nullif(s.details->>'question', '')
    from steps s, n
   order by s.due_at;
$function$;
