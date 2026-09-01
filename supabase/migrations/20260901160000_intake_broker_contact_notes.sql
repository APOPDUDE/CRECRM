-- Fix: notes_one_parent forbids a contact-only row in `notes`, so the broker
-- summary lives in contacts.notes (appended with a dated separator, same style
-- as intake_prospect's description appends).
create or replace function public.intake_broker(p jsonb, p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company_id uuid; v_contact_id uuid;
  v_company text := nullif(p->>'brokerage','');
  v_email   text := nullif(lower(p->>'email'),'');
  v_phone   text := nullif(p->>'phone','');
  v_first   text := coalesce(nullif(p->>'first_name',''),'Unknown');
  v_lines   text[];
  v_body    text;
begin
  if normalize_phone(v_phone) is null and v_email is null then
    raise exception 'a phone or email is required for a broker contact';
  end if;

  if v_company is not null then
    select id into v_company_id from companies where lower(name)=lower(v_company) limit 1;
    if v_company_id is null then
      insert into companies (name, type, phone) values (v_company, 'broker', v_phone)
      returning id into v_company_id;
    end if;
  end if;

  if v_phone is not null then
    select id into v_contact_id from contacts where normalize_phone(phone)=normalize_phone(v_phone) limit 1;
  end if;
  if v_contact_id is null and v_email is not null then
    select id into v_contact_id from contacts where lower(email)=v_email limit 1;
  end if;
  if v_contact_id is null then
    insert into contacts (company_id, first_name, last_name, email, phone, title)
    values (v_company_id, v_first, nullif(p->>'last_name',''), v_email, v_phone,
            coalesce(nullif(p->>'title',''), 'Broker'))
    returning id into v_contact_id;
  else
    update contacts set
      company_id = coalesce(v_company_id, company_id),
      first_name = case when v_first <> 'Unknown' then v_first else first_name end,
      last_name  = coalesce(nullif(p->>'last_name',''), last_name),
      email      = coalesce(v_email, email),
      title      = coalesce(title, 'Broker')
    where id = v_contact_id;
  end if;

  v_lines := array['[Broker contact - via call form]'];
  if nullif(p->>'brokerage','') is not null then v_lines := v_lines || ('Brokerage: ' || (p->>'brokerage')); end if;
  if nullif(p->>'coverage','') is not null then v_lines := v_lines || ('Covers: ' || (p->>'coverage')); end if;
  if nullif(p->>'brought','') is not null then v_lines := v_lines || ('Brought: ' || (p->>'brought')); end if;
  if nullif(p->>'notes','') is not null then v_lines := v_lines || ('Notes: ' || (p->>'notes')); end if;
  if array_length(v_lines, 1) > 1 then
    v_body := array_to_string(v_lines, e'\n');
    update contacts set notes = case
      when notes is null or notes = '' then v_body
      else notes || e'\n\n--- ' || to_char(now() at time zone 'America/New_York', 'Mon DD') || e' ---\n' || v_body
    end
    where id = v_contact_id;
  end if;

  return jsonb_build_object('contact_id', v_contact_id, 'company_id', v_company_id);
end $function$;

revoke execute on function public.intake_broker(jsonb, uuid) from public, anon, authenticated;
