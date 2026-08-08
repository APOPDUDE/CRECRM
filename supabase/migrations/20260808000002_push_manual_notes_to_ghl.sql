-- CRM -> GHL: the other half of the note sync. A note written in the CRE CRM (source
-- 'manual', channel 'note') fires an async HTTP call to n8n (workflow "CRM note push
-- (outbound)", webhook /crm-note-push), which creates the note on the matching GHL
-- contact, suffixed "[via CRE CRM]" -- the marker the inbound sync already skips, so the
-- pushed note's own NoteCreate webhook cannot echo back as a duplicate CRM row.
--
-- Edits push only when body changes: n8n writes the GHL note id back into raw, and that
-- raw-only update must not re-fire or push -> write-back -> push loops forever. Deletes
-- push only when the row ever reached GHL (raw carries ghl_note_id).
--
-- pg_net is fire-and-forget: a dead n8n cannot block or fail the user's insert.
-- Applied live 2026-08-08 via MCP; verified end to end (insert/edit/delete on a real
-- contact, echo count stayed zero).

create extension if not exists pg_net;

create or replace function push_manual_note_to_ghl() returns trigger
language plpgsql
security definer
as $$
declare
  rec record;
  ph text;
  payload jsonb;
begin
  rec := coalesce(new, old);

  if rec.source is distinct from 'manual' or rec.channel is distinct from 'note' then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;

  if tg_op = 'DELETE' and (old.raw is null or not old.raw ? 'ghl_note_id') then
    return old;
  end if;

  -- Manual notes usually carry contact_id, not phone; resolve through the contact.
  ph := rec.phone;
  if ph is null and rec.contact_id is not null then
    select regexp_replace(coalesce(c.phone,''), '\D', '', 'g') into ph
    from contacts c where c.id = rec.contact_id;
  end if;
  if ph is null or ph = '' then
    return coalesce(new, old);
  end if;

  payload := jsonb_build_object(
    'event', lower(tg_op),
    'id', rec.id,
    'phone', ph,
    'body', rec.body,
    'ghl_note_id', rec.raw ->> 'ghl_note_id',
    'ghl_contact_id', rec.raw ->> 'ghl_contact_id'
  );

  perform net.http_post(
    url := 'https://n8n.ayxco.com/webhook/crm-note-push',
    body := payload,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  return coalesce(new, old);
end $$;

drop trigger if exists communications_push_manual_note on communications;
create trigger communications_push_manual_note
  after insert or update or delete on communications
  for each row execute function push_manual_note_to_ghl();
