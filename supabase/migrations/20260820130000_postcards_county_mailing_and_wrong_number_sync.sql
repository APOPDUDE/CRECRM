-- Two findings from the first real round-trip import (list-ios-north-tampa, 2026-08-20):
--
-- 1. TERRAKOTTA MAILING ADDRESSES ARE THE PERSON'S RESIDENCE, NOT THE OWNER'S TAX ADDRESS.
--    Measured: of 102 imported targets with both, 99 DISAGREE with the county owner mailing.
--    Alex's call: postcards never use Terrakotta's mailing. outreach_mail_audience now sources
--    the address from the OWNER (companies.mailing_* via the target's property -- county-fed,
--    complete with city/state/zip on 20,510 owners) and falls back to the skiptraced address
--    only when the county has nothing. The skiptrace addresses stay recorded on the spine --
--    they are where the HUMAN lives, which is its own kind of useful -- they just don't drive
--    the postcard run.
--
-- 2. WRONG-PERSON PROPAGATION (the deferred piece). When the dialer flow marks a GHL contact
--    wrong person, the spine's calls row now learns it: outreach_mark_wrong_number stamps
--    disposition='wrong number' by ghl_contact_id or phone. Per the 2026-08-17 ruling this is
--    a statement about the NUMBER -- the human stays mailable/emailable; only
--    outreach_targets.wrong_person_at (a human's identity call) suppresses across channels.
--    Wired into n8n R44qttkT0bnKCEXI right after its "CRM wrong person" step.
--
-- Plus: the import's owner_mailing conflict rows now show the FULL county address
-- (street, city, state zip) -- the street-only display made complete records look incomplete.

begin;

-- ------------------------------------------------------------------ 1. postcards go to the OWNER
create or replace function outreach_mail_audience(p jsonb) returns jsonb
language plpgsql security definer
set search_path to public, pg_temp
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
  drop table if exists _mail_seen;
  create temp table _mail_seen (na text, zip text, primary key (na, zip)) on commit drop;

  for g in
    select t.id as tid, t.first_name, t.last_name, t.company_name, t.lists,
           t.property_id, t.contact_id, t.wrong_person_at,
           -- The OWNER's county mailing wins; the skiptraced residence is the fallback.
           case when co.mailing_address is not null then co.mailing_address else m.mail_address end as mail_address,
           case when co.mailing_address is not null then co.mailing_city    else m.mail_city    end as mail_city,
           case when co.mailing_address is not null then co.mailing_state   else m.mail_state   end as mail_state,
           case when co.mailing_address is not null then co.mailing_zip     else m.mail_zip     end as mail_zip,
           case when co.mailing_address is not null then 'owner_county' else 'skiptrace' end as mail_source,
           (select max(m2.sent_at) from outreach_mail m2 where m2.target_id = t.id) as last_sent,
           exists (select 1 from outreach_calls oc
                   where oc.target_id = t.id
                     and lower(coalesce(oc.disposition,'')) in ('not interested','said no','no')) as said_no_by_phone,
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
    elsif g.said_no_by_phone then v_hold := 'said_no:phone';
    elsif g.last_sent > now() - make_interval(days => v_recent_days) then v_hold := 'mailed_recently';
    elsif g.mail_city is null or g.mail_zip is null then v_hold := 'incomplete_address';
    elsif exists (select 1 from _mail_seen
                  where na = normalize_mail_address(g.mail_address)
                    and zip = coalesce(upper(btrim(g.mail_zip)),'')) then
      v_hold := 'address_already_in_run';  -- a shared mailbox gets ONE card
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
$$;

comment on function outreach_mail_audience(jsonb) is
  'The postcard run for the picked lists. Addresses come from the OWNER''s county mailing '
  '(companies.mailing_*) and only fall back to the skiptraced residence when the county has '
  'nothing -- measured 2026-08-20: 99 of 102 Terrakotta mailing addresses were the person''s '
  'home, not the owner''s tax address. One card per mailbox. Holds: wrong_person, '
  'said_no:phone, mailed_recently, incomplete_address.';

-- ------------------------------------------------------------------ 2. wrong number propagation
create or replace function outreach_mark_wrong_number(p jsonb) returns jsonb
language plpgsql security definer
set search_path to public
as $$
declare
  v_ghl   text := nullif(btrim(coalesce(p->>'ghl_contact_id','')), '');
  v_phone text := normalize_phone(p->>'phone');
  v_n int := 0;
begin
  if v_ghl is null and v_phone is null then
    return jsonb_build_object('ok', false, 'reason', 'need ghl_contact_id or phone');
  end if;

  -- A wrong PERSON on a call is a wrong NUMBER (2026-08-17 ruling): suppress the phone
  -- everywhere -- call sheets and GHL pushes both exclude it -- while the human stays
  -- mailable and emailable. wrong_person_at is never set here.
  update outreach_calls c
     set disposition = 'wrong number'
   where (v_ghl is not null and c.ghl_contact_id = v_ghl)
      or (v_phone is not null and normalize_phone(c.phone) = v_phone);
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'calls_marked', v_n);
end;
$$;

comment on function outreach_mark_wrong_number(jsonb) is
  'Dialer feedback loop: a GHL contact tagged wrong person marks its spine calls row '
  '"wrong number" (by ghl_contact_id or phone). Number-level only -- the human stays '
  'reachable on the other channels. Called by n8n R44qttkT0bnKCEXI after CRM wrong person.';

commit;
