-- Email channel, part 4 of 4: the return leg -- a classified reply becomes verification.
--
-- WHY THIS IS THE CAREFUL ONE
-- 633 of 697 contacts already carry verified_at. The marginal upside of this pipeline is a
-- handful of new verifications; the downside is corrupting a book that is already 91% verified.
-- So every rule below is written to fail CLOSED: when anything is uncertain the address is
-- credited (email_verified_at) and the person is not (verified_at).
--
-- THE OOO RULING (Alex asked for out-of-office to count -- it does, in the right column)
-- contacts.email_verified_at already means "this address reached the person"; its committed
-- comment from 20260810120000 says "a reply or an out-of-office came back". contacts.verified_at
-- means "a human confirmed this person". An out-of-office is the email channel's voicemail
-- greeting: it proves the mailbox is live and monitored, and proves nothing about the human. So
-- OOO sets email_verified_at and never verified_at -- the same call the phone channel already
-- makes when a voicemail greeting is not a conversation.
--
--   id 1 Interested / 2 Meeting Request / 3 Not Interested / 5 Information Request
--        -> email_verified_at AND verified_at (a human typed something; "no" is still reached)
--   id 4 Do Not Contact  -> both, plus email_opt_out_at
--   id 6 Out Of Office   -> email_verified_at ONLY          (autoresponder)
--   id 7 Wrong Person    -> email_verified_at ONLY          (real mailbox, wrong human)
--                           plus email_identity_suspect_at
--   id 8 Uncategorizable -> nothing; ask Alex
--   id 9 / EMAIL_BOUNCE  -> nothing verified; email_status='invalid', email_bounced_at
--
-- CATEGORY IDS ARE ACCOUNT-SPECIFIC. Smartlead's published example shows Interested as id 5;
-- on this account Interested is 1 and 5 is Information Request. We therefore key on the NAME
-- Smartlead sends (lead_category.new_name / category), falling back to the id only for the ids
-- confirmed live via GET /leads/fetch-categories.
--
-- TWO GUARDS BEFORE verified_at
--   Content guard -- the classifier is loose. It labelled a reply reading only "Sent from my
--   iPad" as Interested. Strip the quoted chain and test what the human actually typed.
--   Relay guard  -- the classifier answers "was this a positive reply", never "who wrote it".
--   "Hi, this is Jane, I handle Bob's properties, he's not interested" is 60+ characters, matches
--   no autoresponder pattern, classifies as Not Interested, and would otherwise stamp verified_at
--   onto Bob. The payload carries reply_from_email and cc_emails; we use them.
--
-- IDEMPOTENT BY CONSTRUCTION. LEAD_CATEGORY_UPDATED carries an old->new transition and fires
-- again on a manual correction in the master inbox (observed live: Out Of Office -> Interested),
-- so Alex fixing a category by hand self-heals the CRM. The communications row is keyed
-- 'smartlead:' || message_id, byte-identical to the 713 rows already imported, so a replay
-- updates rather than duplicates. That matters because delivery to n8n is genuinely lossy
-- (10 failures against 13 successes historically) and a nightly sweep has to be able to replay.

begin;

-- Traceability: "every pin traces to human proof". A verified_at written by this pipeline should
-- be able to name the message that proved it, and be reversible when it turns out to be wrong.
alter table contacts
  add column if not exists verified_evidence_id uuid references communications(id) on delete set null;

comment on column contacts.verified_evidence_id is
  'The communication that proves verified_at, when one exists. Null for the legacy rows verified '
  'before this was recorded. Written by apply_smartlead_event; cleared by unverify_contact.';

-- ---------------------------------------------------------------------------
-- Classification helpers -- kept as their own functions so they can be tested against the 713
-- Smartlead bodies already sitting in communications before anything is trusted in production.
-- ---------------------------------------------------------------------------

-- What the human actually typed: drop the quoted chain, the forwarded header block and any
-- trailing signature, then collapse whitespace.
create or replace function email_reply_significant_text(p_body text)
returns text language sql immutable as $$
  with stripped as (
    select regexp_replace(
             regexp_replace(coalesce(p_body, ''), '<[^>]+>', ' ', 'g'),  -- de-HTML
             '&(nbsp|amp|lt|gt|quot|#39);', ' ', 'g') as t
  ), cut as (
    -- cut at the first quoted-chain marker, whichever appears first
    select split_part(
             regexp_replace(t,
               '(^|\n)\s*(On .{0,120}wrote:|-{2,}\s*Original Message\s*-{2,}|_{10,}|From:\s|Sent from my|Get Outlook for)',
               E'\n\x01', 'i'),
             E'\x01', 1) as t
    from stripped
  )
  select btrim(regexp_replace(t, '\s+', ' ', 'g')) from cut
$$;

-- Did a machine write this?
create or replace function email_reply_is_autoreply(p_text text)
returns boolean language sql immutable as $$
  select coalesce(p_text, '') ~* (
    'out of (the )?office|automatic reply|auto[- ]?reply|autoresponder|currently (away|out)|'
    'on (leave|vacation|holiday|pto)|away from (my )?(desk|email)|will (be )?back on|'
    'no longer (with|at|employed)|has left the (company|firm)|undeliverable|'
    'delivery (has )?failed|mail delivery|address not found'
  )
$$;

-- Did somebody OTHER than the addressee write it? Fails closed: any doubt returns true.
create or replace function email_reply_is_relayed(
  p_target_email text, p_from_email text, p_cc jsonb, p_subject text, p_text text)
returns boolean language sql immutable as $$
  select
    -- replied from a different domain than the one we mailed (real case on this account:
    -- mailed mike.fusek@svn.com, replied from mike@fusekco.com)
    (p_from_email is not null and p_target_email is not null
       and lower(split_part(p_from_email,'@',2)) is distinct from lower(split_part(p_target_email,'@',2)))
    or (p_cc is not null and jsonb_typeof(p_cc) = 'array' and jsonb_array_length(p_cc) > 0)
    or coalesce(p_subject,'') ~* '^\s*(fwd?|fw)\s*:'
    or coalesce(p_text,'') ~* (
         'on behalf of|his assistant|her assistant|their assistant|i handle|i manage the propert|'
         'forwarding (this|you)|passing (this|you) (on|along)|i am the (broker|attorney|agent) for|'
         'copying|looping in'
       )
$$;

-- ---------------------------------------------------------------------------
-- The write-back.
-- ---------------------------------------------------------------------------
create or replace function apply_smartlead_event(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
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
  v_set_addr   boolean := false;   -- credit the ADDRESS
  v_set_person boolean := false;   -- credit the PERSON
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

  -- Normalise the classification. Name first (ids are account-specific), id as the fallback.
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

  -- ---- the two guards -------------------------------------------------
  v_text := email_reply_significant_text(v_body);

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

  -- ---- who is this? ---------------------------------------------------
  select array_agg(id) into v_ids from contacts where lower(btrim(email)) = v_email;

  -- Nobody in the book holds this address yet. A real human answering an email IS the evidence the
  -- doctrine asks for, so mint the contact rather than dropping the reply on the floor -- this is
  -- exactly the gap Alex hit: Bernadette Cooney replied 2026-08-17 and nothing in the CRM showed it.
  -- NOT minted for a bounce (nobody was there).
  --
  -- The name from Smartlead is NOT trustworthy: its enrichment stamps ONE contact name across every
  -- address it finds at a domain, which is why bernadette@lakeshoreathleticservices.com arrives
  -- labelled "Thomas Cooney". So when the Smartlead first name does not appear anywhere in the
  -- address, take the name from the local-part instead and say so in the notes.
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

  -- More than one contact on one address means we cannot say WHICH human replied. Deliverability
  -- is a property of the address and is true for all of them; verification is not.
  if cardinality(v_ids) > 1 then
    v_set_person := false;
    v_downgrade  := coalesce(v_downgrade, 'ambiguous_' || cardinality(v_ids) || '_contacts');
  end if;

  select property_id into v_prop_id
  from communications where contact_id = v_ids[1] and property_id is not null
  order by occurred_at desc limit 1;

  -- ---- the evidence row ----------------------------------------------
  if v_msg_id is not null then
    insert into communications (contact_id, property_id, channel, direction, occurred_at,
                                subject, body, source, external_id, raw)
    values (v_ids[1], v_prop_id, 'email', 'inbound', v_occurred,
            nullif(v_subject,''), v_text, 'smartlead', 'smartlead:' || v_msg_id, p)
    -- The natural key is the composite (source, external_id) -- constraint
    -- communications_source_external_uniq from 20260729000001. Keeping source='smartlead' and the
    -- 'smartlead:<Message-ID>' format byte-identical to the 713 rows already imported means a
    -- replay updates them instead of minting duplicates.
    on conflict (source, external_id) do update
      set body = coalesce(excluded.body, communications.body),
          raw  = coalesce(communications.raw, '{}'::jsonb) || excluded.raw
    returning id into v_comm_id;
  end if;

  -- ---- the writes -----------------------------------------------------
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

    -- Only where verified_at is NULL. An email reply CORROBORATES an existing verification; it
    -- must never overwrite a phone-proven verified_by='verified_owner' with 'response' and reset
    -- the date. 23 of the addresses in this book are already verified by a stronger channel.
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
$fn$;

comment on function apply_smartlead_event is
  'Turn a Smartlead LEAD_CATEGORY_UPDATED / EMAIL_BOUNCE / LEAD_UNSUBSCRIBED event into CRM state. '
  'Out-of-office and Wrong Person credit the ADDRESS (email_verified_at) and never the PERSON '
  '(verified_at). Idempotent on external_id so the nightly reconciliation sweep can replay '
  'anything the webhook dropped.';

-- The reverse operation, shipped alongside so a wrong write is not permanent. Verification
-- becoming write-only and untraceable is exactly how decision_maker became unrecoverable.
create or replace function unverify_contact(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_id uuid := nullif(p->>'contact_id','')::uuid;
  v_reason text := nullif(btrim(coalesce(p->>'reason','')), '');
  v_was text;
begin
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'contact_id required'); end if;
  select verified_by into v_was from contacts where id = v_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no such contact'); end if;

  update contacts
     set verified_at = null, verified_by = null, verified_evidence_id = null,
         email_identity_suspect_at = coalesce(email_identity_suspect_at, now()),
         notes = concat_ws(E'\n', nullif(notes,''),
                 '[' || to_char(now(),'YYYY-MM-DD') || '] verification cleared (was ' ||
                 coalesce(v_was,'null') || ')' || coalesce(' - ' || v_reason, ''))
   where id = v_id;

  return jsonb_build_object('ok', true, 'contact_id', v_id, 'was', v_was);
end;
$fn$;

revoke all on function apply_smartlead_event(jsonb) from public, anon;
revoke all on function unverify_contact(jsonb) from public, anon;
grant execute on function apply_smartlead_event(jsonb) to authenticated, service_role;
grant execute on function unverify_contact(jsonb) to authenticated, service_role;

commit;
