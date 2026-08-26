-- Parcel-level suppression on the mail channel too, so a verified owner is not
-- postcarded at the same building we already have them for.
create or replace function public.outreach_mail_audience(p jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
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
  drop table if exists _mail_seen;
  create temp table _mail_seen (na text, zip text, primary key (na, zip)) on commit drop;

  for g in
    select t.id as tid, t.first_name, t.last_name, t.company_name, t.lists,
           t.property_id, t.contact_id, t.wrong_person_at,
           case when co.mailing_address is not null then co.mailing_address else m.mail_address end as mail_address,
           case when co.mailing_address is not null then co.mailing_city    else m.mail_city    end as mail_city,
           case when co.mailing_address is not null then co.mailing_state   else m.mail_state   end as mail_state,
           case when co.mailing_address is not null then co.mailing_zip     else m.mail_zip     end as mail_zip,
           case when co.mailing_address is not null then 'owner_county' else 'skiptrace' end as mail_source,
           (select max(m2.sent_at) from outreach_mail m2 where m2.target_id = t.id) as last_sent,
           exists (select 1 from outreach_calls oc
                   where oc.target_id = t.id
                     and lower(coalesce(oc.disposition,'')) in ('not interested','said no','no')) as said_no_by_phone,
           exists (select 1 from v_outreach_verified_property v
                    where v.property_id = t.property_id) as parcel_verified,
           pr.address as pr_address, pr.city as pr_city, pr.county as pr_county,
           pr.state as pr_state, pr.zip as pr_zip
      from outreach_targets t
      left join properties pr on pr.id = t.property_id
      left join companies co on co.id = pr.owner_company_id and co.mailing_address is not null
      left join lateral (select m0.* from outreach_mail m0
                         where m0.target_id = t.id order by m0.created_at limit 1) m on true
     where (cardinality(v_lists) = 0 or t.lists && v_lists)
       and (co.mailing_address is not null or m.mail_address is not null)
     order by t.created_at, t.id
     limit v_limit
  loop
    v_total := v_total + 1;
    v_hold := null;

    if g.wrong_person_at is not null then v_hold := 'wrong_person';
    elsif g.parcel_verified then v_hold := 'verified_owner_on_parcel';
    elsif g.said_no_by_phone then v_hold := 'said_no:phone';
    elsif g.last_sent > now() - make_interval(days => v_recent_days) then v_hold := 'mailed_recently';
    elsif g.mail_city is null or g.mail_zip is null then v_hold := 'incomplete_address';
    elsif exists (select 1 from _mail_seen
                  where na = normalize_mail_address(g.mail_address)
                    and zip = coalesce(upper(btrim(g.mail_zip)),'')) then
      v_hold := 'address_already_in_run';
    end if;

    if v_hold is not null then
      if v_hold <> 'address_already_in_run' then
        v_held := v_held || jsonb_build_object('mail_address', g.mail_address, 'reason', v_hold,
                   'first_name', g.first_name, 'last_name', g.last_name);
      end if;
      continue;
    end if;

    insert into _mail_seen values (normalize_mail_address(g.mail_address),
                                   coalesce(upper(btrim(g.mail_zip)),''));

    v_mailable := v_mailable || jsonb_strip_nulls(jsonb_build_object(
      'first_name', g.first_name,
      'last_name', g.last_name,
      'company_name', g.company_name,
      'mail_address', g.mail_address,
      'mail_city', g.mail_city,
      'mail_state', g.mail_state,
      'mail_zip', g.mail_zip,
      'mail_source', g.mail_source,
      'sent_at', g.last_sent,
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
$function$;
