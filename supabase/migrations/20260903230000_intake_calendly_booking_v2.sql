-- intake_calendly_booking v2: never resurrect a dead lead.
-- v1 looked for the contact's OPEN prospect first and created a new one when none existed - so the
-- hourly Calendly poll re-created Ben's lead every hour after Alex marked it dead. Now an existing
-- task for the booking (by invitee key, else same person + same start) pins the lead whatever its
-- status; only a booking with no task yet falls back to "open prospect, else new website lead".
create or replace function public.intake_calendly_booking(p jsonb, p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  v_first text; v_last text;
  v_contact_id uuid; v_prospect_id uuid; v_task_id uuid;
  v_new_contact boolean := false; v_new_prospect boolean := false; v_new_task boolean := false;
  v_local_date date;
begin
  if v_key is null then raise exception 'invitee_uri is required'; end if;
  if v_start is null then raise exception 'start_time is required'; end if;
  if v_status not in ('active', 'canceled') then raise exception 'status must be active or canceled'; end if;
  v_local_date := (v_start at time zone 'America/New_York')::date;

  -- 1. the person
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

  -- 2. an existing task for THIS booking pins the lead, whatever the lead's status (never resurrect)
  select id, prospect_id into v_task_id, v_prospect_id from tasks where source = 'calendly' and external_id = v_key;
  if v_task_id is null then
    select id, prospect_id into v_task_id, v_prospect_id from tasks
     where source = 'calendly' and contact_id = v_contact_id and due_at = v_start
       and (external_id is null or external_id not like 'https://api.calendly.com/%')
     order by created_at limit 1;
  end if;

  -- 3. a booking with no task yet: the contact's open prospect, else a fresh website lead
  if v_prospect_id is null then
    select id into v_prospect_id from prospects
     where owner_id = p_owner and contact_id = v_contact_id and status = 'open'
     order by created_at limit 1;
    if v_prospect_id is null then
      insert into prospects (owner_id, contact_id, description, sourced_by, lead_type, details)
      values (p_owner, v_contact_id,
              '[Website lead - alexpoplawski.com]' || E'\n' || 'Booked a ' || v_ename || ' on Calendly (no form filled).',
              'website', 'user', jsonb_build_object('website', true, 'calendly_only', true))
      returning id into v_prospect_id;
      v_new_prospect := true;
    end if;
  end if;

  -- 4. one task per booking
  if v_task_id is null then
    if v_status = 'active' then
      insert into tasks (owner_id, title, details, kind, due_date, due_at, prospect_id, contact_id, auto_generated, source, external_id)
      values (p_owner, v_ename || ' - ' || coalesce(v_name, 'Calendly booking'),
              'Booked on Calendly from alexpoplawski.com.' || case when v_event is not null then E'\n' || v_event else '' end,
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

  -- 5. the booking on the lead
  update prospects set details = coalesce(details, '{}'::jsonb) || jsonb_build_object('calendly', jsonb_strip_nulls(jsonb_build_object(
      'invitee_uri', v_key, 'event_uri', v_event, 'start_time', v_start, 'end_time', v_end,
      'event_name', v_ename, 'status', v_status, 'task_id', v_task_id)))
  where id = v_prospect_id;

  return jsonb_build_object('prospect_id', v_prospect_id, 'contact_id', v_contact_id, 'task_id', v_task_id,
    'new_contact', v_new_contact, 'new_prospect', v_new_prospect, 'new_task', v_new_task, 'status', v_status,
    'name', v_name, 'email', v_email, 'start_time', v_start, 'event_name', v_ename);
end $$;
