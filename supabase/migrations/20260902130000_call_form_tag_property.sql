-- Call form: seller path stops making prospects (2026-09-02, Alex).
-- A seller call is a VERIFICATION event, not a pipeline card: the form now calls
-- ghl_verify_owner (verify + seat at owner + owners.tags) directly. The one piece
-- that fn cannot do is the property-level 'owner occupier' tag WHEN WE KNOW THE
-- PROPERTY - apply_ghl_tag guesses it from the owner's holdings and refuses
-- multi-property owners ('ambiguous_property'). The form has the exact property
-- from the verify result, so this scoped helper tags it directly.
create or replace function public.call_form_tag_property(p_property_id uuid, p_tag text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tag text := lower(btrim(coalesce(p_tag, '')));
begin
  -- allowlist: this is a dumb pipe for known property tags, not a generic writer
  if v_tag not in ('owner occupier') then
    return jsonb_build_object('ok', false, 'reason', 'tag not allowed: ' || v_tag);
  end if;
  update properties
  set tags = (select array_agg(distinct t) from unnest(coalesce(tags, '{}') || v_tag) t)
  where id = p_property_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'property not found');
  end if;
  return jsonb_build_object('ok', true, 'property_id', p_property_id, 'tag', v_tag);
end $$;

revoke execute on function public.call_form_tag_property(uuid, text) from public, anon, authenticated;
