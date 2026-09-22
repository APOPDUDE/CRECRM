-- Everyone pays for the call now (Alex, 2026-09-21). Two tiers come off the same
-- /consultation questions - $250/60 min outside the US or at score >= 7, $100/30 min for
-- everyone else - and the contact screen is gone, so the answers no longer carry a name,
-- an email or a phone. The Calendly invitee is the only place that identity exists.
--
-- The session id is what ties the two together: the site puts it in the Calendly link as
-- utm_content, Calendly hands it back on the booking, and the booking claims the answers.

alter table consult_intakes add column if not exists session_id text;
create index if not exists consult_intakes_session_idx on consult_intakes (session_id)
  where session_id is not null;

create or replace function public.store_consult_intake(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_id uuid;
begin
  insert into consult_intakes (name, email, phone, company, session_id, payload)
  values (nullif(p->>'name', ''), nullif(lower(p->>'email'), ''), nullif(p->>'phone', ''),
          nullif(p->>'company', ''), nullif(p->>'session_id', ''),
          coalesce(p->'payload', '{}'::jsonb))
  returning id into v_id;
  return jsonb_build_object('intake_id', v_id);
end $function$;

create or replace function public.intake_calendly_booking(p jsonb, p_owner uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_key     text := nullif(p->>'invitee_uri', '');
  v_event   text := nullif(p->>'event_uri', '');
  v_start   timestamptz := nullif(p->>'start_time', '')::timestamptz;
  v_end     timestamptz := nullif(p->>'end_time', '')::timestamptz;
  v_ename   text := coalesce(nullif(p->>'event_name', ''), '30 Minute Meeting');
  v_status  text := coalesce(nullif(p->>'status', ''), 'active');
  v_name    text := nullif(btrim(coalesce(p->>'name', '')), '');
  v_email   text := nullif(lower(btrim(coalesce(p->>'email', ''))), '');
  v_phone   text := nullif(p->>'phone', '');
  v_join    text := nullif(p->>'join_url', '');
  v_resched text := nullif(p->>'reschedule_url', '');
  v_cancel  text := nullif(p->>'cancel_url', '');
  v_sid     text := nullif(p->>'session_id', '');
  v_consult boolean := v_ename ilike '%consult%';
  -- Which tier they bought. Duration is the honest answer; the name is the fallback for a
  -- webhook that arrived without an end time.
  v_mins    int := coalesce(round(extract(epoch from (v_end - v_start)) / 60)::int,
                            case when v_ename ~ '60' then 60 else 30 end);
  v_price   text := case when v_mins >= 45 then '250' else '100' end;
  v_first text; v_last text;
  v_contact_id uuid; v_prospect_id uuid; v_task_id uuid;
  v_new_contact boolean := false; v_new_prospect boolean := false; v_new_task boolean := false;
  v_local_date date;
  v_intake consult_intakes%rowtype;
  v_pl jsonb; v_desc text; v_business text;
begin
  if v_key is null then raise exception 'invitee_uri is required'; end if;
  if v_start is null then raise exception 'start_time is required'; end if;
  if v_status not in ('active', 'canceled') then raise exception 'status must be active or canceled'; end if;
  v_local_date := (v_start at time zone 'America/New_York')::date;

  if v_email is not null then
    select id into v_contact_id from contacts where lower(email) = v_email order by created_at limit 1;
  end if;
  if v_contact_id is null and normalize_phone(v_phone) is not null then
    select id into v_contact_id from contacts where normalize_phone(phone) = normalize_phone(v_phone) order by created_at limit 1;
  end if;
  if v_contact_id is null then
    v_first := split_part(coalesce(v_name, 'Unknown'), ' ', 1);
    v_last  := nullif(btrim(substr(coalesce(v_name, ''), length(v_first) + 1)), '');
    insert into contacts (first_name, last_name, email, phone)
    values (v_first, v_last, v_email, v_phone) returning id into v_contact_id;
    v_new_contact := true;
  end if;

  if v_consult then
    -- The session id is exact, so it wins. Email and phone stay as the fallback for an
    -- intake stored before the contact screen was removed, or a link opened in a new tab.
    if v_sid is not null then
      select * into v_intake from consult_intakes
       where consumed_at is null and session_id = v_sid
       order by created_at desc limit 1;
    end if;
    if v_intake.id is null then
      select * into v_intake from consult_intakes
       where consumed_at is null and created_at > now() - interval '60 days'
         and ((v_email is not null and lower(email) = v_email)
              or (normalize_phone(v_phone) is not null and normalize_phone(phone) = normalize_phone(v_phone)))
       order by created_at desc limit 1;
    end if;
    if v_intake.id is not null then
      v_pl := coalesce(v_intake.payload, '{}'::jsonb);
      -- `pain` is what the funnel asks now; `details` and `question` are the screens it used
      -- to have, kept so an intake stored before today still renders.
      v_business := coalesce(nullif(v_pl->>'pain', ''), nullif(v_pl->>'details', ''));
      v_desc := '[Consultation ($' || v_price || ' / ' || v_mins || ' min) - alexpoplawski.com/consultation'
                || case when coalesce(v_pl->>'via', '') <> '' then ' via ' || (v_pl->>'via') else '' end || ']'
                || case when coalesce(v_pl->>'summary', '') <> '' then E'\n' || (v_pl->>'summary') else '' end
                || case when coalesce(v_business, '') <> '' then E'\nBroken: ' || v_business else '' end
                || case when coalesce(v_pl->>'question', '') <> '' then E'\nQuestion: ' || (v_pl->>'question') else '' end;
      if v_intake.company is not null then
        update contacts set company_id = coalesce(company_id, (select id from companies where lower(name) = lower(v_intake.company) limit 1)) where id = v_contact_id;
      end if;
    end if;
  end if;

  select id, prospect_id into v_task_id, v_prospect_id from tasks where source = 'calendly' and external_id = v_key;
  if v_task_id is null then
    select id, prospect_id into v_task_id, v_prospect_id from tasks
     where source = 'calendly' and contact_id = v_contact_id and due_at = v_start
       and (external_id is null or external_id not like 'https://api.calendly.com/%')
     order by created_at limit 1;
  end if;

  if v_prospect_id is null then
    select id into v_prospect_id from prospects
     where owner_id = p_owner and contact_id = v_contact_id and status = 'open'
     order by created_at limit 1;
    if v_prospect_id is null then
      insert into prospects (owner_id, contact_id, description, sourced_by, lead_type, details)
      values (p_owner, v_contact_id,
              coalesce(v_desc, case when v_consult then '[Consultation ($' || v_price || ' / ' || v_mins || ' min) - alexpoplawski.com/consultation]' || E'\n' || 'Booked a paid consultation on Calendly (no answers on file).'
                                    else '[Website lead - alexpoplawski.com]' || E'\n' || 'Booked a ' || v_ename || ' on Calendly (no form filled).' end),
              'website', 'user',
              jsonb_build_object('website', true, 'calendly_only', v_desc is null, 'form', case when v_consult then 'consultation' else 'lead' end)
              || coalesce(v_pl, '{}'::jsonb))
      returning id into v_prospect_id;
      v_new_prospect := true;
    elsif v_desc is not null then
      update prospects
         set description = coalesce(description, '') || E'\n\n--- ' || to_char(now() at time zone 'America/New_York', 'Mon DD') || E' ---\n' || v_desc,
             details = coalesce(details, '{}'::jsonb) || coalesce(v_pl, '{}'::jsonb) || jsonb_build_object('form', 'consultation')
       where id = v_prospect_id;
    end if;
  elsif v_desc is not null and coalesce((select details->>'form' from prospects where id = v_prospect_id), '') <> 'consultation' then
    update prospects
       set description = coalesce(description, '') || E'\n\n--- ' || to_char(now() at time zone 'America/New_York', 'Mon DD') || E' ---\n' || v_desc,
           details = coalesce(details, '{}'::jsonb) || coalesce(v_pl, '{}'::jsonb) || jsonb_build_object('form', 'consultation')
     where id = v_prospect_id;
  end if;
  if v_intake.id is not null then
    update consult_intakes set consumed_at = now(), prospect_id = v_prospect_id where id = v_intake.id;
  end if;

  if v_task_id is null then
    if v_status = 'active' then
      insert into tasks (owner_id, title, details, kind, due_date, due_at, prospect_id, contact_id, auto_generated, source, external_id)
      values (p_owner, v_ename || ' - ' || coalesce(v_name, 'Calendly booking'),
              case when v_consult then 'Paid consultation ($' || v_price || ' / ' || v_mins || ' min) booked on Calendly.' else 'Booked on Calendly from alexpoplawski.com.' end
              || case when v_event is not null then E'\n' || v_event else '' end,
              'meeting', v_local_date, v_start, v_prospect_id, v_contact_id, true, 'calendly', v_key)
      returning id into v_task_id;
      v_new_task := true;
    end if;
  else
    update tasks set
      external_id = v_key,
      due_at = v_start, due_date = v_local_date,
      prospect_id = coalesce(prospect_id, v_prospect_id),
      status = case when v_status = 'canceled' then 'done'::task_status else status end,
      title = case when v_status = 'canceled' then 'Canceled: ' || regexp_replace(title, '^Canceled: ', '')
                   else regexp_replace(title, '^Canceled: ', '') end
    where id = v_task_id;
  end if;

  update prospects set details = coalesce(details, '{}'::jsonb) || jsonb_build_object('calendly', jsonb_strip_nulls(jsonb_build_object(
      'invitee_uri', v_key, 'event_uri', v_event, 'start_time', v_start, 'end_time', v_end,
      'event_name', v_ename, 'status', v_status, 'task_id', v_task_id, 'consult', v_consult,
      'price', case when v_consult then v_price else null end,
      'minutes', case when v_consult then v_mins else null end,
      'join_url', v_join, 'reschedule_url', v_resched, 'cancel_url', v_cancel)))
  where id = v_prospect_id;

  return jsonb_build_object('prospect_id', v_prospect_id, 'contact_id', v_contact_id, 'task_id', v_task_id,
    'new_contact', v_new_contact, 'new_prospect', v_new_prospect, 'new_task', v_new_task, 'status', v_status,
    'name', v_name, 'email', v_email, 'start_time', v_start, 'event_name', v_ename, 'join_url', v_join,
    'consult', v_consult, 'price', v_price, 'minutes', v_mins, 'intake_found', v_intake.id is not null,
    'need_label', v_pl->>'need_label', 'business', v_business, 'pain', v_pl->>'pain',
    'question', v_pl->>'question', 'stage_label', v_pl->>'stage_label', 'found', v_pl->>'found');
end $function$;

-- Both paid events now have "Consultation" in the name, so the old name-only test collapsed
-- the $100 and the $250 into one chip. Duration is what separates them.
create or replace view v_lead_board as
select
  p.id as prospect_id,
  case when p.status = 'dead' then 'dead'
       else lead_board_stage(p.manual_stage,
              nullif(p.details -> 'calendly' ->> 'start_time', '')::timestamptz,
              p.details -> 'calendly' ->> 'status')
  end as stage,
  p.manual_stage,
  p.temperature,
  nullif(p.details -> 'calendly' ->> 'start_time', '')::timestamptz as meeting_at,
  nullif(p.details -> 'calendly' ->> 'end_time', '')::timestamptz as meeting_ends_at,
  p.details -> 'calendly' ->> 'event_name' as meeting_event,
  case
    when p.details -> 'calendly' ->> 'event_name' is null then null
    when p.details -> 'calendly' ->> 'event_name' ilike '%consult%' then
      case when coalesce(
             round(extract(epoch from (nullif(p.details -> 'calendly' ->> 'end_time', '')::timestamptz
                                     - nullif(p.details -> 'calendly' ->> 'start_time', '')::timestamptz)) / 60)::int,
             case when p.details -> 'calendly' ->> 'event_name' ~ '60' then 60 else 30 end) >= 45
           then 'consult_250' else 'consult_100' end
    -- "Software walkthrough" was the free half hour it replaced; leave those rows alone.
    when p.details -> 'calendly' ->> 'event_name' ilike '%software%' then 'software'
    else 'space'
  end as meeting_type,
  p.details ->> 'form' as form,
  case when p.details ->> 'qualified' = '0' then false
       when p.details ->> 'qualified' = '1' then true
       else null end as qualified,
  nullif(p.details ->> 'score', '')::integer as score,
  p.next_action_date,
  p.next_action_description,
  p.status
from prospects p;
