-- The other two channels get their audience builders: calls and postcards.
--
-- Same shape as outreach_audience (email): pick lists, get back who is reachable on THIS channel
-- and why the rest are held. Channel-specific suppression only -- a wrong NUMBER holds the phone
-- and never the mail; wrong_person_at on the target holds everything.
--
--   calls: held when wrong_person / dnc number / bad number (wrong number disposition) /
--          said no already (disposition or the contact's do_not_call) / called recently
--   mail:  held when wrong_person / said no by phone / mailed recently (sent_at)
--
-- Postcards go to the mailing ADDRESS row -- one row per address by construction, so a couple
-- sharing a mailbox gets one card, which is what a mail house wants.

begin;

create or replace function outreach_call_audience(p jsonb) returns jsonb
language plpgsql security definer
set search_path to public
as $$
declare
  v_recent_days int    := coalesce((p->>'recent_days')::int, 14);
  v_limit       int    := least(coalesce((p->>'limit')::int, 5000), 20000);
  v_lists       text[] := coalesce((select array_agg(btrim(x)) from jsonb_array_elements_text(
                            case when jsonb_typeof(p->'lists')='array' then p->'lists' else '[]'::jsonb end) x
                          where btrim(x) <> ''), '{}'::text[]);
  v_callable jsonb := '[]'::jsonb;
  v_held     jsonb := '[]'::jsonb;
  v_total    int   := 0;
  g record;
  v_hold text;
begin
  for g in
    select c.id, c.phone, c.line_type, c.phone_grade, c.disposition, c.attempts,
           c.last_call_at, c.dnc, c.ghl_contact_id,
           t.first_name, t.last_name, t.company_name, t.email, t.lists,
           t.property_id, t.contact_id, t.wrong_person_at,
           ct.do_not_call as contact_dnc,
           pr.address as pr_address, pr.city as pr_city, pr.county as pr_county
      from outreach_calls c
      join outreach_targets t on t.id = c.target_id
      left join contacts ct on ct.id = t.contact_id
      left join properties pr on pr.id = t.property_id
     where (cardinality(v_lists) = 0 or t.lists && v_lists)
     order by c.last_call_at nulls first, c.phone
     limit v_limit
  loop
    v_total := v_total + 1;
    v_hold := null;

    if g.wrong_person_at is not null then v_hold := 'wrong_person';
    elsif g.dnc then v_hold := 'dnc';
    elsif lower(coalesce(g.disposition,'')) in ('wrong number','disconnected','bad number')
                                         then v_hold := 'bad_number';
    elsif lower(coalesce(g.disposition,'')) in ('not interested','said no','no','do not call')
                                         then v_hold := 'said_no';
    elsif coalesce(g.contact_dnc, false) then v_hold := 'said_no';
    elsif g.last_call_at > now() - make_interval(days => v_recent_days)
                                         then v_hold := 'called_recently';
    end if;

    if v_hold is not null then
      v_held := v_held || jsonb_build_object('phone', g.phone, 'reason', v_hold,
                 'first_name', g.first_name, 'last_name', g.last_name);
      continue;
    end if;

    v_callable := v_callable || jsonb_strip_nulls(jsonb_build_object(
      'phone', g.phone,
      'first_name', g.first_name,
      'last_name', g.last_name,
      'company_name', g.company_name,
      'email', g.email,
      'line_type', g.line_type,
      'phone_grade', g.phone_grade,
      'disposition', g.disposition,
      'attempts', g.attempts,
      'last_call_at', g.last_call_at,
      'ghl_contact_id', g.ghl_contact_id,
      'property_address', g.pr_address,
      'property_city', g.pr_city,
      'property_county', g.pr_county,
      'crm_contact_id', g.contact_id,
      'crm_property_id', g.property_id,
      'lists', to_jsonb(g.lists)
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'source', 'outreach_calls',
    'counts', jsonb_build_object(
      'pool_total', (select count(*) from outreach_calls),
      'considered', v_total,
      'callable',   jsonb_array_length(v_callable),
      'held',       jsonb_array_length(v_held)),
    'callable', v_callable,
    'held', v_held);
end;
$$;

comment on function outreach_call_audience(jsonb) is
  'The phone channel of the picked lists: one row per NUMBER with grade/type/disposition and the '
  'property context. Holds: wrong_person, dnc, bad_number, said_no, called_recently. Read-only.';

create or replace function outreach_mail_audience(p jsonb) returns jsonb
language plpgsql security definer
set search_path to public
as $$
declare
  v_recent_days int    := coalesce((p->>'recent_days')::int, 120);
  v_limit       int    := least(coalesce((p->>'limit')::int, 5000), 20000);
  v_lists       text[] := coalesce((select array_agg(btrim(x)) from jsonb_array_elements_text(
                            case when jsonb_typeof(p->'lists')='array' then p->'lists' else '[]'::jsonb end) x
                          where btrim(x) <> ''), '{}'::text[]);
  v_mailable jsonb := '[]'::jsonb;
  v_held     jsonb := '[]'::jsonb;
  v_total    int   := 0;
  g record;
  v_hold text;
begin
  for g in
    select m.id, m.mail_address, m.mail_city, m.mail_state, m.mail_zip,
           m.sent_at, m.mail_status,
           t.first_name, t.last_name, t.company_name, t.lists,
           t.property_id, t.contact_id, t.wrong_person_at,
           exists (select 1 from outreach_calls oc
                   where oc.target_id = t.id
                     and lower(coalesce(oc.disposition,'')) in ('not interested','said no','no')) as said_no_by_phone,
           pr.address as pr_address, pr.city as pr_city, pr.county as pr_county,
           pr.state as pr_state, pr.zip as pr_zip
      from outreach_mail m
      join outreach_targets t on t.id = m.target_id
      left join properties pr on pr.id = t.property_id
     where (cardinality(v_lists) = 0 or t.lists && v_lists)
     order by m.sent_at nulls first, m.mail_address
     limit v_limit
  loop
    v_total := v_total + 1;
    v_hold := null;

    if g.wrong_person_at is not null then v_hold := 'wrong_person';
    elsif g.said_no_by_phone then v_hold := 'said_no:phone';
    elsif g.sent_at > now() - make_interval(days => v_recent_days) then v_hold := 'mailed_recently';
    end if;

    if v_hold is not null then
      v_held := v_held || jsonb_build_object('mail_address', g.mail_address, 'reason', v_hold,
                 'first_name', g.first_name, 'last_name', g.last_name);
      continue;
    end if;

    v_mailable := v_mailable || jsonb_strip_nulls(jsonb_build_object(
      'first_name', g.first_name,
      'last_name', g.last_name,
      'company_name', g.company_name,
      'mail_address', g.mail_address,
      'mail_city', g.mail_city,
      'mail_state', g.mail_state,
      'mail_zip', g.mail_zip,
      'sent_at', g.sent_at,
      'mail_status', g.mail_status,
      'property_address', g.pr_address,
      'property_city', g.pr_city,
      'property_county', g.pr_county,
      'property_state', g.pr_state,
      'property_zip', g.pr_zip,
      'crm_contact_id', g.contact_id,
      'crm_property_id', g.property_id,
      'lists', to_jsonb(g.lists)
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'source', 'outreach_mail',
    'counts', jsonb_build_object(
      'pool_total', (select count(*) from outreach_mail),
      'considered', v_total,
      'mailable',   jsonb_array_length(v_mailable),
      'held',       jsonb_array_length(v_held)),
    'mailable', v_mailable,
    'held', v_held);
end;
$$;

comment on function outreach_mail_audience(jsonb) is
  'The postcard channel of the picked lists: one row per MAILING ADDRESS (a shared mailbox gets '
  'one card). Holds: wrong_person, said_no:phone, mailed_recently. Read-only -- marking sent '
  'happens when a mail run actually goes out.';

commit;
