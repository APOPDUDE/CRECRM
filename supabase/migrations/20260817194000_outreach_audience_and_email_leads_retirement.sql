-- The email channel moves onto the spine, and email_leads retires.
--
-- 1. outreach_audience(p jsonb): same contract email_lead_audience had (the /email page and
--    launcher render leads source-agnostically), but reads outreach_email x outreach_targets.
--    Property facts come ONLY from the joined CRM property -- county-sourced, trigger-locked.
--    New hold: wrong_person, the spine's only cross-channel suppression.
-- 2. apply_smartlead_event: the pool-sync block now writes outreach_email, and a genuine
--    promotion stamps outreach_targets.contact_id (still the only bridge to the verified book).
--    Every guard is unchanged.
-- 3. email_leads and its machinery drop. The full pre-image lives in email_leads_archive
--    (migration 20260817193000); the 2,469 property-linked rows live on the spine. Verified:
--    no n8n workflow reads email_leads directly -- everything goes through the RPCs.

begin;

-- ------------------------------------------------------------------ 1. the audience
create or replace function outreach_audience(p jsonb) returns jsonb
language plpgsql security definer
set search_path to public
as $$
declare
  v_dry         boolean := coalesce((p->>'dry_run')::boolean, true);
  v_campaign_id text    := nullif(btrim(coalesce(p->>'campaign_id','')), '');
  v_audience    text    := nullif(btrim(coalesce(p->>'audience','')), '');
  v_recent_days int     := coalesce((p->>'recent_days')::int, 60);
  v_limit       int     := least(coalesce((p->>'limit')::int, 5000), 20000);
  v_unanswered  boolean := coalesce((p->>'never_answered')::boolean, true);
  v_lists       text[]  := coalesce((select array_agg(btrim(x)) from jsonb_array_elements_text(
                             case when jsonb_typeof(p->'lists')='array' then p->'lists' else '[]'::jsonb end) x
                           where btrim(x) <> ''), '{}'::text[]);
  v_sendable jsonb := '[]'::jsonb;
  v_held     jsonb := '[]'::jsonb;
  v_total    int   := 0;
  g record;
  v_hold text;
begin
  if not v_dry and v_campaign_id is null then
    return jsonb_build_object('ok', false, 'reason', 'campaign_id is required when dry_run is false');
  end if;

  for g in
    select e.id as email_id, e.email, e.email_status, e.last_campaigned_at as e_campaigned,
           e.last_reply_at, e.bounced_at, e.opted_out_at,
           t.first_name, t.last_name, t.company_name, t.phone, t.lists,
           t.parcel_id, t.property_id, t.contact_id, t.wrong_person_at,
           exists (select 1 from outreach_calls oc
                   where oc.target_id = t.id
                     and lower(coalesce(oc.disposition,'')) in ('not interested','said no','no')) as said_no_by_phone,
           c.archived, c.do_not_call, c.email_opt_out_at as c_optout,
           c.email_bounced_at as c_bounced, c.email_identity_suspect_at as c_suspect,
           c.email_last_campaigned_at as c_campaigned,
           pr.property_type, pr.address as pr_address, pr.city as pr_city, pr.county as pr_county,
           pr.state as pr_state, pr.zip as pr_zip, pr.gross_sf, pr.land_acres
      from outreach_email e
      join outreach_targets t on t.id = e.target_id
      left join contacts c on c.id = t.contact_id
      left join properties pr on pr.id = t.property_id
     where (cardinality(v_lists) = 0 or t.lists && v_lists)
     order by e.last_campaigned_at nulls first, e.email
     limit v_limit
  loop
    v_total := v_total + 1;
    v_hold := null;

    if g.wrong_person_at is not null                  then v_hold := 'wrong_person';
    -- A phone "no" is a human "no": emailing them is the highest-complaint message in any list.
    -- (A wrong NUMBER, by contrast, never holds the email channel.)
    elsif g.said_no_by_phone                          then v_hold := 'said_no:phone';
    elsif v_unanswered and g.last_reply_at is not null then v_hold := 'already_replied';
    elsif g.bounced_at   is not null                  then v_hold := 'previously_bounced';
    elsif g.opted_out_at is not null                  then v_hold := 'opted_out';
    elsif g.email_status in ('invalid','spamtrap','abuse','do_not_mail')
                                                      then v_hold := 'undeliverable:' || g.email_status::text;
    elsif g.archived                                  then v_hold := 'contact_archived';
    elsif g.do_not_call                               then v_hold := 'contact_do_not_call';
    elsif g.c_optout   is not null                    then v_hold := 'opted_out';
    elsif g.c_bounced  is not null                    then v_hold := 'previously_bounced';
    elsif g.c_suspect  is not null                    then v_hold := 'identity_suspect';
    elsif greatest(g.e_campaigned, g.c_campaigned) > now() - make_interval(days => v_recent_days)
                                                      then v_hold := 'campaigned_recently';
    end if;

    if v_hold is not null then
      v_held := v_held || jsonb_build_object('email', g.email, 'reason', v_hold,
                 'first_name', g.first_name, 'property_address', g.pr_address);
      continue;
    end if;

    if not v_dry then
      update outreach_email set last_campaigned_at = now() where id = g.email_id;
    end if;

    v_sendable := v_sendable || jsonb_build_object(
      'email', g.email,
      'first_name', g.first_name,
      'last_name',  g.last_name,
      'phone_number', g.phone,
      'company_name', g.company_name,
      'custom_fields', jsonb_strip_nulls(jsonb_build_object(
        'first_name',       g.first_name,
        'last_name',        g.last_name,
        'company_name',     g.company_name,
        'owner_name',       g.company_name,
        'property_address', g.pr_address,
        'street',           nullif(btrim(regexp_replace(coalesce(g.pr_address, ''), '^[0-9\-]+\s*', '')), ''),
        'city',             g.pr_city,
        'county',           g.pr_county,
        'state',            g.pr_state,
        'zip',              g.pr_zip,
        'property_type',    replace(g.property_type::text, '_', ' '),
        'building_sf',      g.gross_sf::text,
        'land_acres',       g.land_acres::text,
        'parcel_id',        g.parcel_id,
        'crm_contact_id',   g.contact_id,
        'crm_property_id',  g.property_id,
        'audience',         v_audience
      )),
      'ghl_contact_ids', '[]'::jsonb,
      'ghl_rows_collapsed', 1,
      'crm_contact_id', g.contact_id,
      'crm_property_id', g.property_id,
      'lists', to_jsonb(g.lists),
      'domain_type', case when split_part(g.email,'@',2) = any (array[
        'gmail.com','yahoo.com','aol.com','hotmail.com','outlook.com','icloud.com','msn.com',
        'comcast.net','bellsouth.net','verizon.net','att.net','me.com','live.com','tampabay.rr.com',
        'sbcglobal.net','cox.net','earthlink.net','ymail.com','mac.com','juno.com'])
        then 'consumer' else 'business' end
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'dry_run', v_dry,
    'audience', v_audience,
    'source', 'outreach',
    'counts', jsonb_build_object(
      'pool_total',   (select count(*) from outreach_email),
      'considered',   v_total,
      'addresses',    v_total,
      'ghl_rows',     v_total,
      'address_rows', v_total,
      'sendable',     jsonb_array_length(v_sendable),
      'held',         jsonb_array_length(v_held),
      'contacts_minted', 0
    ),
    'sendable', v_sendable,
    'held', v_held
  );
end;
$$;

comment on function outreach_audience(jsonb) is
  'Build an email audience from the outreach spine (lists -> outreach_targets x outreach_email). '
  'Same lead contract email_lead_audience had. Dry run writes nothing; a committing run stamps '
  'outreach_email.last_campaigned_at. Property facts come only from the joined CRM property.';

-- ------------------------------------------------------------------ 2. reply sync repoint
-- Full recreate of apply_smartlead_event; the ONLY change is the pool-sync block at the end
-- (email_leads -> outreach_email + outreach_targets.contact_id). Every guard is untouched.
create or replace function public.apply_smartlead_event(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_event      text := upper(coalesce(p->>'event_type',''));
  v_email      text := lower(btrim(coalesce(p->>'lead_email', p->>'to_email', p->>'to', '')));
  v_cat_name   text := lower(btrim(coalesce(p#>>'{lead_category,new_name}', p->>'category', '')));
  v_cat_id     int  := nullif(btrim(coalesce(p->>'lead_category_id', p->>'reply_category','')), '')::int;
  v_msg_id     text := coalesce(p#>>'{lastReply,message_id}', p->>'message_id');
  v_body       text := coalesce(p#>>'{lastReply,email_body}', p->>'reply_body', p->>'preview_text');
  v_from       text := lower(btrim(coalesce(p#>>'{lastReply,reply_from_email}',
                                            p#>>'{leadCorrespondence,replyReceivedFrom}','')));
  v_cc         jsonb := coalesce(p#>'{lastReply,cc_emails}', p->'cc_emails');
  v_subject    text := coalesce(p->>'subject', '');
  v_occurred   timestamptz := coalesce(nullif(p#>>'{lastReply,time}','')::timestamptz,
                                       nullif(p->>'time_replied','')::timestamptz, now());
  v_campaign   text := coalesce(p->>'campaign_name', p->>'campaign_id');
  v_text       text;
  v_ids        uuid[];
  v_comm_id    uuid;
  v_prop_id    uuid;
  v_set_addr   boolean := false;
  v_set_person boolean := false;
  v_bounce     boolean := false;
  v_optout     boolean := false;
  v_suspect    boolean := false;
  v_downgrade  text;
  v_ghl_tag    text;
  v_verified   int := 0;
  v_minted     boolean := false;
begin
  if v_email = '' then
    return jsonb_build_object('ok', false, 'reason', 'lead_email missing');
  end if;

  if v_cat_name = '' and v_cat_id is not null then
    v_cat_name := case v_cat_id
      when 1 then 'interested' when 2 then 'meeting request' when 3 then 'not interested'
      when 4 then 'do not contact' when 5 then 'information request' when 6 then 'out of office'
      when 7 then 'wrong person' when 8 then 'uncategorizable by ai'
      when 9 then 'sender originated bounce' else '' end;
  end if;

  if v_event in ('EMAIL_BOUNCE','EMAIL_BOUNCED') or v_cat_name like '%bounce%'
     or coalesce((p->>'is_bounced')::boolean, false) then
    v_bounce := true;
  elsif v_event in ('LEAD_UNSUBSCRIBED','EMAIL_UNSUBSCRIBED')
     or coalesce((p->>'is_unsubscribed')::boolean, false) then
    v_optout := true; v_set_addr := true; v_ghl_tag := 'email-optout';
  else
    case v_cat_name
      when 'interested'          then v_set_addr := true; v_set_person := true; v_ghl_tag := 'email-interested';
      when 'meeting request'     then v_set_addr := true; v_set_person := true; v_ghl_tag := 'email-interested';
      when 'information request' then v_set_addr := true; v_set_person := true; v_ghl_tag := 'email-replied';
      when 'not interested'      then v_set_addr := true; v_set_person := true; v_ghl_tag := 'email-not-interested';
                                      v_optout := true;
      when 'do not contact'      then v_set_addr := true; v_set_person := true; v_ghl_tag := 'email-optout';
                                      v_optout := true;
      when 'out of office'       then v_set_addr := true; v_ghl_tag := 'email-replied';
                                      v_downgrade := 'out_of_office_is_an_autoresponder';
      when 'wrong person'        then v_set_addr := true; v_suspect := true; v_ghl_tag := 'email-wrong-person';
                                      v_downgrade := 'wrong_person';
      else v_ghl_tag := 'email-replied';
    end case;
  end if;

  v_text := email_reply_significant_text(v_body);

  -- A "reply" that is really a bounce notification is a BOUNCE. Smartlead records NDRs as replies,
  -- and without this the address would be stamped valid and the person verified.
  if not v_bounce and email_reply_is_bounce_notice(v_text) then
    v_bounce := true; v_set_addr := false; v_set_person := false;
    v_downgrade := 'bounce_notification_not_a_reply';
  end if;

  -- What they ASKED FOR beats what the classifier called it. "Take me off your list" on a
  -- Wrong Person reply is still an opt-out, and would otherwise be mailed again.
  if not v_bounce and email_reply_is_optout(v_text) then
    v_optout := true; v_ghl_tag := 'email-optout';
  end if;

  if v_set_person then
    if v_text is null or length(v_text) < 25 then
      v_set_person := false;
      v_downgrade := 'thin_reply_' || coalesce(length(v_text), 0) || '_chars';
    elsif email_reply_is_autoreply(v_text) then
      v_set_person := false; v_downgrade := 'autoresponder_content';
    elsif email_reply_is_relayed(v_email, v_from, v_cc, v_subject, v_text) then
      v_set_person := false; v_suspect := true; v_downgrade := 'relay_suspected';
    end if;
  end if;

  -- Keep the OUTREACH SPINE in step BEFORE any early return: most spine addresses have no CRM
  -- contact, and a bounce for one of them must still mark outreach_email. The spine is the
  -- mailable universe; contacts is the verified book.
  update outreach_email e
     set last_reply_at  = case when v_bounce then e.last_reply_at
                               else greatest(e.last_reply_at, v_occurred) end,
         reply_category = coalesce(nullif(v_cat_name,''), e.reply_category),
         bounced_at     = case when v_bounce then coalesce(e.bounced_at, v_occurred) else e.bounced_at end,
         opted_out_at   = case when v_optout then coalesce(e.opted_out_at, v_occurred) else e.opted_out_at end,
         email_verified_at = case when v_set_addr and not v_bounce
                                  then coalesce(e.email_verified_at, v_occurred)
                                  else e.email_verified_at end,
         email_status   = case when v_bounce then 'invalid'::email_deliverability
                               when v_set_addr and (e.email_status is null
                                    or e.email_status in ('unknown','catch_all'))
                               then 'valid'::email_deliverability else e.email_status end,
         email_status_at = case when v_bounce or v_set_addr then now() else e.email_status_at end
   where lower(btrim(e.email)) = v_email;

  select array_agg(id) into v_ids from contacts where lower(btrim(email)) = v_email;

  -- Mint when nobody holds the address. The name from Smartlead is NOT trustworthy: its enrichment
  -- stamps ONE contact name across every address at a domain, which is why
  -- bernadette@lakeshoreathleticservices.com arrives labelled "Thomas Cooney". When the Smartlead
  -- first name does not appear anywhere in the address, take the name from the local-part instead
  -- and record in the notes that it needs a human eye.
  if v_ids is null and not v_bounce and v_set_addr then
    declare
      v_sl_first text := nullif(btrim(coalesce(p#>>'{lead_data,first_name}', p->>'first_name',
                                  split_part(coalesce(p->>'lead_name',''), ' ', 1))), '');
      v_sl_last  text := nullif(btrim(coalesce(p#>>'{lead_data,last_name}', p->>'last_name',
                                  nullif(regexp_replace(coalesce(p->>'lead_name',''), '^\S+\s*', ''), ''))), '');
      v_local    text := split_part(v_email, '@', 1);
      v_stamped  boolean;
      v_new_id   uuid;
    begin
      v_stamped := v_sl_first is null or position(lower(v_sl_first) in v_local) = 0;
      insert into contacts (first_name, last_name, email, source, notes)
      values (
        initcap(coalesce(nullif(case when v_stamped
                    then btrim(regexp_replace(v_local, '[._0-9-]+', ' ', 'g'))
                    else v_sl_first end, ''), 'Unknown')),
        case when v_stamped then null else initcap(v_sl_last) end,
        v_email,
        'smartlead',
        'Created by the Smartlead reply sync (' || coalesce(nullif(v_cat_name,''),'reply') || ', ' ||
        coalesce(v_campaign,'?') || ').' ||
        case when v_stamped and v_sl_first is not null
             then ' Smartlead labelled this address "' || v_sl_first || ' ' || coalesce(v_sl_last,'') ||
                  '", which does not match the address -- Smartlead stamps one name across a whole '
                  'domain, so the name here came from the address instead. Worth checking.'
             else '' end
      )
      returning id into v_new_id;
      v_ids := array[v_new_id];
      v_minted := true;
    end;
  end if;

  if v_ids is null then
    return jsonb_build_object(
      'ok', true, 'matched', 0, 'minted', false, 'email', v_email, 'category', v_cat_name,
      'slack_text', format('Smartlead %s from %s (%s) - no CRM contact, and not minted (%s).',
                           coalesce(nullif(v_cat_name,''),'reply'), v_email, coalesce(v_campaign,'?'),
                           case when v_bounce then 'bounce' else 'nothing to credit' end));
  end if;

  if cardinality(v_ids) > 1 then
    v_set_person := false;
    v_downgrade  := coalesce(v_downgrade, 'ambiguous_' || cardinality(v_ids) || '_contacts');
  end if;

  select property_id into v_prop_id
  from communications where contact_id = v_ids[1] and property_id is not null
  order by occurred_at desc limit 1;

  if v_msg_id is not null then
    insert into communications (contact_id, property_id, channel, direction, occurred_at,
                                subject, body, source, external_id, raw)
    values (v_ids[1], v_prop_id, 'email', 'inbound', v_occurred,
            nullif(v_subject,''), v_text, 'smartlead', 'smartlead:' || v_msg_id, p)
    on conflict (source, external_id) do update
      set body = coalesce(excluded.body, communications.body),
          raw  = coalesce(communications.raw, '{}'::jsonb) || excluded.raw
    returning id into v_comm_id;
  end if;

  if v_bounce then
    update contacts
       set email_bounced_at    = coalesce(email_bounced_at, now()),
           email_status        = 'invalid',
           email_status_at     = now(),
           email_status_source = 'bounce'
     where id = any(v_ids);
    v_ghl_tag := 'email-bounced';
  else
    if v_set_addr then
      update contacts
         set email_verified_at   = coalesce(email_verified_at, v_occurred),
             email_status        = case when email_status is null or email_status in ('unknown','catch_all')
                                        then 'valid' else email_status end,
             email_status_at     = case when email_status is null or email_status in ('unknown','catch_all')
                                        then now() else email_status_at end,
             email_status_source = case when email_status is null or email_status in ('unknown','catch_all')
                                        then 'smartlead' else email_status_source end
       where id = any(v_ids);
    end if;

    if v_optout then
      update contacts set email_opt_out_at = coalesce(email_opt_out_at, now()) where id = any(v_ids);
    end if;

    if v_suspect then
      update contacts set email_identity_suspect_at = coalesce(email_identity_suspect_at, now())
       where id = any(v_ids);
    end if;

    if v_set_person then
      update contacts
         set verified_at          = v_occurred,
             verified_by          = 'response',
             verified_evidence_id = v_comm_id
       where id = any(v_ids)
         and verified_at is null
         and email_identity_suspect_at is null;
      get diagnostics v_verified = row_count;
    end if;
  end if;

  -- A real conversation is the ONLY thing that bridges a target into the verified book.
  if not v_bounce then
    update outreach_targets t
       set contact_id = coalesce(t.contact_id, v_ids[1])
      from outreach_email e
     where e.target_id = t.id and lower(btrim(e.email)) = v_email;
  end if;

  return jsonb_build_object(
    'ok', true,
    'email', v_email,
    'category', v_cat_name,
    'matched', cardinality(v_ids),
    'minted', v_minted,
    'contact_ids', to_jsonb(v_ids),
    'communication_id', v_comm_id,
    'email_verified_set', v_set_addr and not v_bounce,
    'person_verified', v_verified,
    'downgrade_reason', v_downgrade,
    'ambiguous', cardinality(v_ids) > 1,
    'ghl_tag', v_ghl_tag,
    'ghl_category_value', v_cat_name,
    'slack_text', format(
      '*%s* - %s (%s)%s%s',
      coalesce(nullif(v_cat_name,''), 'reply'), v_email, coalesce(v_campaign,'?'),
      case when v_verified > 0 then E'\n:white_check_mark: person verified in the CRM'
           when v_downgrade is not null then E'\n:warning: address credited only - ' || v_downgrade
           else '' end,
      case when v_text is not null and v_text <> '' then E'\n> ' || left(v_text, 300) else '' end)
  );
end;
$function$;

-- ------------------------------------------------------------------ 3. retirement
drop view if exists v_email_leads_unanswered;
drop view if exists v_email_lead_lists;
drop function if exists email_lead_audience(jsonb);
drop function if exists import_email_leads(jsonb);
drop function if exists resolve_email_lead_properties(jsonb);
drop table if exists email_leads;
drop function if exists email_lead_normalize_address(text);

commit;
