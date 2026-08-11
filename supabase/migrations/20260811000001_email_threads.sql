-- Email campaign threads become conversations.
--
-- The campaign CSVs carried a lead's STATUS and CATEGORY and nothing else, so a contact
-- who wrote back showed no correspondence at all -- the conversation log had only the
-- HubSpot call history, and the strongest signal in the book (someone answered) was
-- invisible. Smartlead keeps the whole thread per lead; these rows are those messages.
--
-- from/to live in `raw`, not new columns: they matter for email and are meaningless for
-- a call or an SMS, and the conversation log already reads `raw` for channel-specific
-- detail. Storing them keeps a reply readable a year later, when "who was this even
-- sent to" is the first question -- especially where one person has several addresses.
--
-- external_id is the Smartlead message id, so re-running the harvest updates rather than
-- duplicates. Where Smartlead gives no id the campaign, lead and timestamp make one.

alter type comm_source add value if not exists 'smartlead';

-- One communications row per message. Idempotent on (source, external_id).
--
-- Identity is resolved by EMAIL here, not phone: resolve_communication_identity only
-- knows how to fold a phone number, and these rows often have no phone at all. The
-- lead's address is matched against contacts, then the contact's owner link supplies
-- owner_id, and the owner's property supplies property_id when the owner holds exactly
-- one -- attributing a thread to a specific building is only safe when there is no
-- ambiguity about which building that is.
create or replace function import_email_threads(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r jsonb;
  v_ct uuid; v_owner uuid; v_prop uuid; v_ext text; v_dir comm_direction;
  v_email text; v_phone text; v_n int;
  n_in int := 0; n_ins int := 0; n_ct_new int := 0; n_skipped int := 0;
  n_owner int := 0; n_prop int := 0;
begin
  for r in select * from jsonb_array_elements(p) loop
    n_in := n_in + 1;
    v_email := lower(nullif(btrim(coalesce(r->>'lead_email','')), ''));
    v_ct := null; v_owner := null; v_prop := null;

    if v_email is not null then
      select id into v_ct from contacts where lower(btrim(email)) = v_email limit 1;
    end if;

    -- communications_needs_identity demands a contact or a phone, and an email thread has
    -- neither when the address is one we never imported -- the lead lists picked ONE
    -- address per person, so a second address arrives orphaned. Creating the contact is
    -- the only way to keep the message, and 74 of these are REPLIES. It may add a second
    -- row for someone already in the book under another address: a merge to make later,
    -- not a thread to lose.
    if v_ct is null and v_email is not null then
      v_phone := nullif(btrim(coalesce(r->>'lead_phone','')), '');
      if v_phone is not null and exists (
        select 1 from contacts c2 where normalize_phone(c2.phone) = normalize_phone(v_phone)
      ) then
        v_phone := null;   -- one contact per number; a thread does not get to steal it
      end if;
      insert into contacts (first_name, last_name, email, phone, source_system)
      values (coalesce(nullif(btrim(coalesce(r->>'lead_first','')), ''), split_part(v_email,'@',1)),
              nullif(btrim(coalesce(r->>'lead_last','')), ''),
              v_email, v_phone, 'smartlead')
      returning id into v_ct;
      n_ct_new := n_ct_new + 1;
    end if;

    if v_ct is null then n_skipped := n_skipped + 1; continue; end if;

    select oc.owner_id into v_owner from owner_contacts oc
    where oc.contact_id = v_ct
    order by (oc.confidence = 'confirmed') desc limit 1;
    if v_owner is not null then
      n_owner := n_owner + 1;
      -- Count first, then take the row. Postgres has no min(uuid), and
      -- "select id ... having count(*) = 1" needs a GROUP BY -- both of which fail ONLY
      -- HERE, on the owner path, which a contact with no owner link never reaches. Two
      -- rewrites passed single-row tests and died in bulk before this one was verified
      -- against a contact that actually has an owner.
      select count(*) into v_n from properties where owner_id = v_owner;
      if v_n = 1 then
        select id into v_prop from properties where owner_id = v_owner limit 1;
        n_prop := n_prop + 1;
      end if;
    end if;

    v_dir := case when upper(coalesce(r->>'type','')) = 'REPLY'
                  then 'inbound'::comm_direction else 'outbound'::comm_direction end;
    v_ext := 'smartlead:' || coalesce(nullif(r->>'message_id',''),
             (r->>'campaign_id') || ':' || (r->>'lead_id') || ':' || coalesce(r->>'time',''));

    insert into communications (contact_id, owner_id, property_id, channel, direction,
                                occurred_at, subject, body, source, external_id, raw)
    values (v_ct, v_owner, v_prop, 'email', v_dir,
            coalesce(nullif(r->>'time','')::timestamptz, now()),
            nullif(btrim(coalesce(r->>'subject','')), ''),
            nullif(btrim(coalesce(r->>'body','')), ''),
            'smartlead', v_ext,
            jsonb_strip_nulls(jsonb_build_object(
              'from', nullif(btrim(coalesce(r->>'from','')), ''),
              'to', nullif(btrim(coalesce(r->>'to','')), ''),
              'campaign', nullif(btrim(coalesce(r->>'campaign','')), ''),
              'campaign_id', r->>'campaign_id',
              'lead_id', r->>'lead_id')))
    on conflict (source, external_id) do update
      set body = excluded.body,
          subject = coalesce(excluded.subject, communications.subject),
          contact_id = coalesce(communications.contact_id, excluded.contact_id),
          owner_id = coalesce(communications.owner_id, excluded.owner_id),
          property_id = coalesce(communications.property_id, excluded.property_id),
          raw = coalesce(communications.raw, '{}'::jsonb) || excluded.raw;
    n_ins := n_ins + 1;
  end loop;
  return jsonb_build_object('ok', true, 'received', n_in, 'written', n_ins,
    'contacts_created', n_ct_new, 'skipped_no_identity', n_skipped,
    'linked_owner', n_owner, 'linked_property', n_prop);
end $$;
