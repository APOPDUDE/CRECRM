-- Mirror GHL text messages into the conversation history.
--
-- GHL's /conversations/messages/export returns calls and texts in one stream, and the poll
-- workflow already fetches it every 2 minutes but keeps only TYPE_CALL. This function is the
-- other half: hand it the raw `messages` array and it files the texts.
--
-- The mapping lives here rather than in the n8n Code node so the backfill, the poll, and any
-- future caller agree on one definition of "a text" -- the project rule is that business rules
-- live in Postgres.
--
-- Three message types are all texts, and the distinction is the CHANNEL not the content:
--   TYPE_SMS                  inbound replies (real SMS and Blooio iMessage both arrive as this)
--   TYPE_CUSTOM_SMS           outbound over a custom provider
--   TYPE_CUSTOM_PROVIDER_SMS  outbound over Blooio's marketplace app
-- Every one of them is "Alex texted this number" or "this number texted back", so they collapse
-- to channel='sms' and the real distinction we keep is `direction`.
--
-- Whose number to file it against: GHL puts the counterparty on opposite sides depending on
-- direction, and the OTHER side is a channel LABEL, not a number -- outbound `from` reads
-- 'Blooio - iMessages', inbound `to` reads 'Axis deals'. So it is `from` on inbound, `to` on
-- outbound, which is the same rule the call logger already uses.
--
-- Rows whose counterparty is not a 10-digit US number are dropped, not failed: those are
-- shortcode traffic (Terrakotta's own verification codes come from 57564) and belong to nobody.
-- communications_needs_identity would reject them anyway.
--
-- contact_id/owner_id are deliberately left null -- the communications_resolve_identity trigger
-- fills them from the phone, which is also what makes a text land on a contact created later.

create or replace function import_ghl_texts(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  seen int;
  texts int;
  with_phone int;
  inserted int;
begin
  create temp table _ghl_in on commit drop as
  select
    m ->> 'id'                                  as external_id,
    m ->> 'messageType'                         as message_type,
    lower(coalesce(m ->> 'direction', ''))      as direction,
    (m ->> 'dateAdded')::timestamptz            as occurred_at,
    normalize_phone(case when lower(coalesce(m ->> 'direction','')) = 'inbound'
                         then m ->> 'from' else m ->> 'to' end) as phone,
    nullif(btrim(coalesce(m ->> 'body', '')), '') as body,
    jsonb_build_object(
      'ghl_contact_id',      m ->> 'contactId',
      'ghl_message_id',      m ->> 'id',
      'ghl_conversation_id', m ->> 'conversationId',
      'message_type',        m ->> 'messageType',
      'status',              m ->> 'status',
      'from',                m ->> 'from',
      'to',                  m ->> 'to'
    ) as raw
  from jsonb_array_elements(coalesce(p, '[]'::jsonb)) m;

  select count(*) into seen from _ghl_in;
  select count(*) into texts from _ghl_in
   where message_type in ('TYPE_SMS', 'TYPE_CUSTOM_SMS', 'TYPE_CUSTOM_PROVIDER_SMS');
  select count(*) into with_phone from _ghl_in
   where message_type in ('TYPE_SMS', 'TYPE_CUSTOM_SMS', 'TYPE_CUSTOM_PROVIDER_SMS')
     and phone is not null and external_id is not null and occurred_at is not null;

  with ins as (
    insert into communications (source, external_id, channel, direction, occurred_at, phone, body, raw)
    select 'ghl', i.external_id, 'sms',
           case i.direction when 'inbound' then 'inbound'::comm_direction
                            when 'outbound' then 'outbound'::comm_direction
                            else 'unknown'::comm_direction end,
           i.occurred_at, i.phone, i.body, i.raw
    from (
      -- one row per message id; a single export page can repeat an id across cursor overlap
      select distinct on (external_id) *
      from _ghl_in
      where message_type in ('TYPE_SMS', 'TYPE_CUSTOM_SMS', 'TYPE_CUSTOM_PROVIDER_SMS')
        and phone is not null and external_id is not null and occurred_at is not null
      order by external_id, occurred_at desc
    ) i
    on conflict (source, external_id) do nothing
    returning 1
  )
  select count(*) into inserted from ins;

  return jsonb_build_object(
    'seen', seen, 'texts', texts, 'with_phone', with_phone,
    'inserted', inserted, 'already_had', with_phone - inserted,
    'skipped_no_phone', texts - with_phone
  );
end $$;

comment on function import_ghl_texts(jsonb) is
  'Files GHL text messages (TYPE_SMS / TYPE_CUSTOM_SMS / TYPE_CUSTOM_PROVIDER_SMS) into '
  'communications as channel=sms, keyed on (source, external_id) so it is replay-safe. '
  'Takes the raw `messages` array from /conversations/messages/export.';

grant execute on function import_ghl_texts(jsonb) to authenticated, service_role;
