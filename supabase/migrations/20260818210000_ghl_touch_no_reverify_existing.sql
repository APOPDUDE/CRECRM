-- 2026-08-18: verified means SPOKE WITH, per number (Alex). The inbound GHL tag poll
-- was re-stamping verified_at on existing unverified contacts because the CRM's own
-- derived-tag push puts 'owner occupier' on GHL contacts from county evidence — the tag
-- no longer proves a VA reached them. Existing contacts now keep their verification
-- state; only brand-new mints (unknown to the CRM, so necessarily human-tagged in GHL)
-- still arrive verified as ghl_va.
-- Context: the 08-13 backfill audit (context/audit-verified-batch-20260818.md) unverified
-- 134 contacts; the poller re-verified 3 of them within 15 minutes via this function.
create or replace function public.ghl_touch_verified_contact(p jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ghl   text := nullif(btrim(coalesce(p->>'ghl_contact_id', '')), '');
  v_phone text := normalize_phone(p->>'phone');
  v_email text := nullif(btrim(coalesce(p->>'email', '')), '');
  v_first text := nullif(btrim(coalesce(p->>'first', '')), '');
  v_last  text := nullif(btrim(coalesce(p->>'last', '')), '');
  v_id    uuid;
begin
  if v_ghl is not null then
    select id into v_id from contacts where ghl_contact_id = v_ghl;
  end if;
  if v_id is null and v_phone is not null and length(v_phone) = 10 then
    select id into v_id from contacts
    where normalize_phone(phone) = v_phone
    order by created_at asc limit 1;
  end if;
  if v_id is null and v_email is not null then
    select id into v_id from contacts
    where lower(email) = lower(v_email)
    order by created_at asc limit 1;
  end if;

  if v_id is null then
    if v_phone is null and v_email is null then
      return null;
    end if;
    insert into contacts (first_name, last_name, phone, email, source, ghl_contact_id,
                          verified_at, verified_by, archived)
    values (coalesce(v_first, p->>'phone', v_email, 'Unknown'), v_last,
            nullif(btrim(coalesce(p->>'phone', '')), ''), v_email, 'ghl', v_ghl,
            now(), 'ghl_va', false)
    returning id into v_id;
    return v_id;
  end if;

  -- Existing contact: link the GHL id and surface it, but NEVER change verification
  -- state here. verified_at is earned by a conversation, not by a tag round-trip.
  update contacts set
    ghl_contact_id = coalesce(ghl_contact_id, v_ghl),
    archived       = false
  where id = v_id
    and (ghl_contact_id is null or archived);
  return v_id;
end $function$;
