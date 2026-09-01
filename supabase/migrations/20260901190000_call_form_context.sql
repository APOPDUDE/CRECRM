-- Who is this caller to the CRM already? Backs the call form's "known contact" banner
-- so Alex sees existing deals/tags/verification BEFORE logging a category - answering
-- "is this a new contact or one with a deal attached". Read-only; service-role only
-- (the n8n form renderer calls it; the intakes themselves stay the write path).
create or replace function public.call_form_context(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_contact contacts%rowtype;
begin
  if normalize_phone(p_phone) is null then
    return jsonb_build_object('known', false);
  end if;
  select * into v_contact from contacts
   where normalize_phone(phone) = normalize_phone(p_phone) limit 1;
  if v_contact.id is null then
    return jsonb_build_object('known', false);
  end if;
  return jsonb_build_object(
    'known', true,
    'contact', jsonb_build_object(
      'id', v_contact.id,
      'name', btrim(coalesce(v_contact.first_name,'') || ' ' || coalesce(v_contact.last_name,'')),
      'title', v_contact.title,
      'verified_at', v_contact.verified_at,
      'company', (select name from companies where id = v_contact.company_id)),
    'client', (
      select jsonb_build_object('id', c.id, 'status', c.status, 'deal_type', c.deal_type,
        'pursuits', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'address', pr.address, 'stage', p.stage, 'tour_date', p.tour_date)
                   order by p.updated_at desc), '[]'::jsonb)
          from (select * from pursuits where client_id = c.id
                order by updated_at desc limit 5) p
          join properties pr on pr.id = p.property_id))
      from clients c
      where c.contact_id = v_contact.id and c.status in ('prospect','searching','negotiating')
      order by c.created_at limit 1),
    'prospect', (
      select jsonb_build_object('id', pr.id, 'lead_type', pr.lead_type)
      from prospects pr
      where pr.contact_id = v_contact.id and pr.status = 'open'
      order by pr.created_at limit 1),
    'landlord_listings', (
      select coalesce(jsonb_agg(jsonb_build_object('address', prp.address, 'stage', l.stage)), '[]'::jsonb)
      from listings l join properties prp on prp.id = l.property_id
      where l.landlord_contact_id = v_contact.id and l.status = 'active')
  );
end $$;

revoke execute on function public.call_form_context(text) from public, anon, authenticated;
