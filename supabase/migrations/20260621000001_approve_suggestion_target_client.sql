-- Let the broker choose which searching client a suggested property is added to.
-- approve_suggestion gains an optional p_client_id override; null keeps the original
-- behaviour (add to the client the property was suggested for). The single-arg version
-- is dropped so a 1-arg call unambiguously resolves to this default-bearing version.

drop function if exists public.approve_suggestion(uuid);

create or replace function public.approve_suggestion(p_suggestion_id uuid, p_client_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_pursuit uuid; v_prop uuid; v_client uuid;
begin
  select property_id, coalesce(p_client_id, client_id) into v_prop, v_client
    from suggestions where id = p_suggestion_id;
  if v_prop is null then raise exception 'suggestion % not found', p_suggestion_id; end if;
  if v_client is null then raise exception 'no target client for suggestion %', p_suggestion_id; end if;

  select id into v_pursuit from pursuits where client_id = v_client and property_id = v_prop limit 1;
  if v_pursuit is null then
    insert into pursuits (property_id, client_id, owner_id, stage, inquiry_date, flagged_new)
    select v_prop, v_client, c.owner_id, 'inquiring', current_date, true from clients c where c.id = v_client
    returning id into v_pursuit;
  end if;
  delete from suggestions where id = p_suggestion_id;
  return v_pursuit;
end $function$;

grant execute on function public.approve_suggestion(uuid, uuid) to anon, authenticated, service_role;
