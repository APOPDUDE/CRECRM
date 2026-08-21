-- The VA's per-row "send" tap: flips a draft queue row to approved. This is the
-- human-initiation step (FTSA posture) -- campaigns enqueue DRAFTS, a human tap
-- approves each one, the worker only ever claims approved rows.
-- VA writes are RLS-blocked by design, so the tap is a SECURITY DEFINER RPC,
-- and the pre-request guard allowlist gains /rpc/va_approve_send.

begin;

create or replace function va_approve_send(p_send_id uuid) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  update text_sends
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_send_id and status = 'draft';
  if found then
    return jsonb_build_object('ok', true, 'send_id', p_send_id);
  end if;

  select status::text into v_status from text_sends where id = p_send_id;
  return jsonb_build_object('ok', false, 'send_id', p_send_id,
                            'reason', coalesce('status is ' || v_status, 'not found'));
end;
$$;

create or replace function public.va_guard_pre_request() returns void
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_path text := current_setting('request.path', true);
begin
  if not public.is_va() then
    return;
  end if;

  if v_path is null then
    raise insufficient_privilege using
      message = 'va_guard_pre_request: request.path unavailable -- VA requests fail closed';
  end if;

  if v_path like '/rpc/%'
     and v_path not in ('/rpc/va_send_reply',
                        '/rpc/va_confirm_owner',
                        '/rpc/va_wrong_person',
                        '/rpc/va_not_interested',
                        '/rpc/va_thread_context',
                        '/rpc/va_approve_send') then
    raise insufficient_privilege using
      message = format('VA role may not call %s', v_path);
  end if;
end;
$$;

commit;
