-- attach_prospect_to_client(p_prospect_id, p_client_id): "this lead became that client".
-- The Buyer rep push on a lead lets Alex fill the buyer criteria in the Add buyer dialog (which
-- creates the client itself); this RPC then does the bookkeeping convert_prospect does for the
-- tenant path: pursuits for the lead's attached properties, open tasks re-homed on the client,
-- lead marked converted -> client.
create or replace function public.attach_prospect_to_client(p_prospect_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p prospects%rowtype;
  v_owner uuid;
  v_prop uuid; v_pursuit uuid; v_pursuit_ids uuid[] := '{}';
begin
  select * into v_p from prospects where id = p_prospect_id for update;
  if not found then raise exception 'prospect % not found', p_prospect_id; end if;
  if v_p.status <> 'open' then raise exception 'prospect already %', v_p.status; end if;
  select owner_id into v_owner from clients where id = p_client_id;
  if v_owner is null then raise exception 'client % not found', p_client_id; end if;

  for v_prop in select property_id from prospect_properties where prospect_id = p_prospect_id loop
    if not exists (select 1 from pursuits where client_id = p_client_id and property_id = v_prop) then
      insert into pursuits (property_id, client_id, owner_id, stage, inquiry_date)
      values (v_prop, p_client_id, v_owner, 'inquiring', current_date)
      returning id into v_pursuit;
      v_pursuit_ids := v_pursuit_ids || v_pursuit;
    end if;
  end loop;

  update tasks set client_id = p_client_id
   where prospect_id = p_prospect_id and status = 'open' and client_id is null;

  update prospects set status = 'converted', converted_to = 'client', converted_at = now()
   where id = p_prospect_id;

  return jsonb_build_object('client_id', p_client_id, 'pursuit_ids', to_jsonb(v_pursuit_ids));
end $$;

revoke all on function public.attach_prospect_to_client(uuid, uuid) from public, anon;
grant execute on function public.attach_prospect_to_client(uuid, uuid) to authenticated, service_role;
