-- Same parcel-level suppression as the GHL push: if the property already has a verified
-- owner, no phone at that property is callable -- not just the verified number.
-- Adds the hold reason 'verified_owner_on_parcel'.
create or replace function public.outreach_call_audience(p jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
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
           pr.address as pr_address, pr.city as pr_city, pr.county as pr_county,
           exists (select 1 from v_outreach_verified_property v
                    where v.property_id = t.property_id) as parcel_verified
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
    elsif g.parcel_verified              then v_hold := 'verified_owner_on_parcel';
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
$function$;
