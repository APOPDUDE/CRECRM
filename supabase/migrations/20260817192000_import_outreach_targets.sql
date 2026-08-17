-- import_outreach_targets(p jsonb) -- THE ONLY DOOR into the outreach spine.
--
-- One skiptraced list (Terrakotta CSV, a GHL harvest, a legacy pool) comes in as jsonb rows;
-- each row becomes (or merges into) one PERSON in outreach_targets plus a child row per channel
-- that has data. Two doors is what split the Nicole list (552 imported, 45 tagged), so the UI,
-- the legacy loads and any future automation all call this.
--
-- MATCHING (identity layer 3) -- strongest first, stop at the first hit:
--   1. phone  (normalize_phone)        -- what contacts already keys on
--   2. email  (lower(btrim(...)))
--   3. normalized name + anchor (property_id or company_id) -- never name alone
--
-- THE GUARD: a phone match must NEVER bind a new email onto a target that already holds a
-- different one. Shared landlines are the commonest skip-trace artifact ("ROBERT MARSHALL" at
-- tonymars@tampabay.rr.com phone-matches TONY MARSHALL holding tonymars40@verizon.net). Email
-- match -> bind. Phone match with no conflicting email -> bind. Phone match with a DIFFERENT
-- email -> mint a separate target flagged shared_phone_conflicting_email. Same rule
-- apply_smartlead_event enforces for contacts.
--
-- PROPERTY RESOLUTION never guesses: unambiguous parcel (comma-split, because 343 parcel_number
-- values hold several parcels and 105 (county,parcel) groups are duplicated), then unambiguous
-- normalized address + city. Ambiguity flags the target instead of anchoring it.
--
-- WRONG NUMBER != WRONG PERSON: an incoming "wrong person" disposition maps to 'wrong number'
-- (the phone was bad; it says nothing about the human, who must stay emailable). Only an
-- explicit wrong_person=true on the row sets outreach_targets.wrong_person_at.

begin;

create or replace function import_outreach_targets(p jsonb) returns jsonb
language plpgsql security definer
set search_path to public, pg_temp
as $$
declare
  v_list   text := lower(regexp_replace(btrim(coalesce(p->>'list','')), '\s+', '-', 'g'));
  v_source text := coalesce(nullif(btrim(p->>'source'),''), 'terrakotta');
  r jsonb;

  -- per-row working state
  v_first text; v_last text; v_name text; v_company text; v_name_source text;
  v_phone_raw text; v_phone text; v_email text;
  v_mail text; v_mail_norm text; v_mail_city text; v_mail_state text; v_mail_zip text;
  v_parcel text; v_prop_addr text; v_prop_city text;
  v_prop uuid; v_prop_n int;
  v_comp uuid;
  v_disp text; v_hold text;
  v_tid uuid; v_matched text;
  v_other uuid;

  -- report counters
  c_rows int := 0; c_skipped int := 0;
  c_new int := 0; c_existing int := 0; c_verified int := 0;
  c_by_phone int := 0; c_by_email int := 0; c_by_name int := 0;
  c_new_phone int := 0; c_new_email int := 0; c_new_mail int := 0;
  c_held int := 0;
  v_held jsonb := '[]'::jsonb;
begin
  if v_list = '' then
    return jsonb_build_object('ok', false, 'reason', 'list name is required');
  end if;
  if v_list not like 'list-%' then
    v_list := 'list-' || v_list;
  end if;
  if v_source not in ('terrakotta','ghl','smartlead','manual') then
    return jsonb_build_object('ok', false, 'reason', 'unknown source ' || v_source);
  end if;
  if jsonb_typeof(p->'rows') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'reason', 'rows must be an array');
  end if;

  -- Property resolution is per-row but must not seq-scan properties per row: materialise the
  -- lookup once. Parcels comma-split so an assemblage row can still resolve.
  drop table if exists _ot_parcel;
  drop table if exists _ot_addr;
  create temp table _ot_parcel on commit drop as
    select pr.id, upper(btrim(x)) as parcel
    from properties pr, unnest(string_to_array(coalesce(pr.parcel_number,''), ',')) x
    where btrim(x) <> '';
  create index on _ot_parcel (parcel);

  create temp table _ot_addr on commit drop as
    select pr.id, normalize_mail_address(pr.address) as na,
           upper(btrim(coalesce(pr.city,''))) as city
    from properties pr
    where pr.address is not null;
  create index on _ot_addr (na, city);

  for r in select * from jsonb_array_elements(p->'rows') loop
    c_rows := c_rows + 1;

    v_first  := nullif(btrim(coalesce(r->>'first_name','')), '');
    v_last   := nullif(btrim(coalesce(r->>'last_name','')), '');
    v_company:= nullif(btrim(coalesce(r->>'company_name','')), '');
    v_name_source := nullif(btrim(coalesce(r->>'name_source','')), '');
    v_phone_raw := nullif(btrim(coalesce(r->>'phone','')), '');
    v_phone  := normalize_phone(v_phone_raw);
    v_email  := lower(btrim(coalesce(r->>'email','')));
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' then v_email := null; end if;
    v_mail       := nullif(btrim(coalesce(r->>'mailing_address','')), '');
    v_mail_norm  := normalize_mail_address(v_mail);
    v_mail_city  := nullif(btrim(coalesce(r->>'mailing_city','')), '');
    v_mail_state := nullif(btrim(coalesce(r->>'mailing_state','')), '');
    v_mail_zip   := nullif(btrim(coalesce(r->>'mailing_zip','')), '');
    v_parcel     := nullif(upper(regexp_replace(coalesce(r->>'parcel_id',''), '\s', '', 'g')), '');
    v_prop_addr  := nullif(btrim(coalesce(r->>'property_address','')), '');
    v_prop_city  := nullif(btrim(coalesce(r->>'property_city','')), '');
    v_name := nullif(upper(btrim(coalesce(v_first,'') || ' ' || coalesce(v_last,''))), '');

    -- Wrong number != wrong person: the phone was bad, the human stays emailable.
    v_disp := lower(nullif(btrim(coalesce(r->>'disposition','')), ''));
    if v_disp in ('wrong person','wrong_person') then v_disp := 'wrong number'; end if;

    if v_phone is null and v_email is null and v_mail_norm is null then
      c_skipped := c_skipped + 1;
      continue;  -- nothing reachable on any channel
    end if;

    -- ---------------------------------------------------------------- anchors
    v_prop := null; v_prop_n := 0; v_hold := null;
    if v_parcel is not null then
      select count(distinct id), min(id::text)::uuid into v_prop_n, v_prop
      from _ot_parcel where parcel = v_parcel;
    end if;
    if v_prop_n = 0 and v_prop_addr is not null and v_prop_city is not null
       and length(coalesce(normalize_mail_address(v_prop_addr),'')) >= 6 then
      select count(distinct id), min(id::text)::uuid into v_prop_n, v_prop
      from _ot_addr
      where na = normalize_mail_address(v_prop_addr)
        and city = upper(btrim(v_prop_city));
    end if;
    if v_prop_n > 1 then
      v_prop := null; v_hold := 'ambiguous_property';
    elsif v_prop_n = 0 and (v_parcel is not null or v_prop_addr is not null) then
      v_hold := 'no_anchor';
    end if;

    v_comp := null;
    if v_company is not null then
      select id into v_comp from companies
      where normalized_name = normalize_owner_name(v_company);
    end if;
    if v_comp is not null and v_hold = 'no_anchor' then
      v_hold := null;  -- the company anchors them even when the property could not
    end if;

    -- ---------------------------------------------------------------- match, strongest first
    v_tid := null; v_matched := null;
    if v_phone is not null then
      select target_id into v_tid from outreach_calls
      where normalize_phone(phone) = v_phone limit 1;
      if v_tid is not null then v_matched := 'phone'; end if;
    end if;

    -- THE GUARD: phone-matched target already holding a different email
    if v_matched = 'phone' and v_email is not null
       and exists (select 1 from outreach_email e where e.target_id = v_tid)
       and not exists (select 1 from outreach_email e
                       where e.target_id = v_tid and lower(btrim(e.email)) = v_email) then
      v_tid := null; v_matched := null;
      v_hold := 'shared_phone_conflicting_email';
      v_phone := null;  -- the number stays with the target that owns it
    end if;

    if v_tid is null and v_email is not null then
      select target_id into v_tid from outreach_email
      where lower(btrim(email)) = v_email limit 1;
      if v_tid is not null then v_matched := 'email'; end if;
    end if;

    if v_tid is null and v_name is not null and (v_prop is not null or v_comp is not null) then
      select case when count(distinct id) = 1 then min(id::text)::uuid end into v_tid
      from outreach_targets t
      where upper(btrim(coalesce(t.first_name,'') || ' ' || coalesce(t.last_name,''))) = v_name
        and ((v_prop is not null and t.property_id = v_prop)
          or (v_comp is not null and t.company_id  = v_comp));
      if v_tid is not null then v_matched := 'name_anchor'; end if;
    end if;

    -- ---------------------------------------------------------------- spine row
    if v_tid is null then
      insert into outreach_targets
        (first_name, last_name, name_source, company_name, phone, email,
         mailing_address, mailing_city, mailing_state, mailing_zip,
         property_id, parcel_id, company_id, lists, source, hold_reason,
         wrong_person_at, raw)
      values
        (v_first, v_last, v_name_source, v_company, v_phone_raw, v_email,
         v_mail, v_mail_city, v_mail_state, v_mail_zip,
         v_prop, v_parcel, v_comp, array[v_list], v_source, v_hold,
         case when coalesce((r->>'wrong_person')::boolean, false) then now() end,
         coalesce(r->'raw', r))
      returning id into v_tid;
      c_new := c_new + 1;
      if v_hold is not null then
        c_held := c_held + 1;
        if jsonb_array_length(v_held) < 200 then
          v_held := v_held || jsonb_build_object(
            'name', coalesce(v_name, v_company, v_email, v_phone_raw),
            'reason', v_hold);
        end if;
      end if;
    else
      c_existing := c_existing + 1;
      if v_matched = 'phone' then c_by_phone := c_by_phone + 1;
      elsif v_matched = 'email' then c_by_email := c_by_email + 1;
      else c_by_name := c_by_name + 1; end if;

      if exists (select 1 from outreach_targets t join contacts c on c.id = t.contact_id
                 where t.id = v_tid and c.verified_at is not null) then
        c_verified := c_verified + 1;
      end if;

      update outreach_targets t
         set lists           = case when v_list = any(t.lists) then t.lists else t.lists || v_list end,
             first_name      = coalesce(t.first_name, v_first),
             last_name       = coalesce(t.last_name, v_last),
             company_name    = coalesce(t.company_name, v_company),
             mailing_address = coalesce(t.mailing_address, v_mail),
             mailing_city    = coalesce(t.mailing_city, v_mail_city),
             mailing_state   = coalesce(t.mailing_state, v_mail_state),
             mailing_zip     = coalesce(t.mailing_zip, v_mail_zip),
             property_id     = coalesce(t.property_id, v_prop),
             parcel_id       = coalesce(t.parcel_id, v_parcel),
             company_id      = coalesce(t.company_id, v_comp)
       where t.id = v_tid;
    end if;

    -- ---------------------------------------------------------------- channel children
    if v_phone is not null then
      select target_id into v_other from outreach_calls where normalize_phone(phone) = v_phone;
      if v_other is null then
        insert into outreach_calls (target_id, phone, disposition, line_type, phone_grade, dnc, ghl_contact_id)
        values (v_tid, v_phone_raw, v_disp,
                nullif(btrim(coalesce(r->>'line_type','')), ''),
                nullif(btrim(coalesce(r->>'phone_grade','')), ''),
                coalesce((r->>'dnc')::boolean, false),
                nullif(btrim(coalesce(r->>'ghl_contact_id','')), ''));
        c_new_phone := c_new_phone + 1;
      else
        update outreach_calls c
           set disposition    = coalesce(v_disp, c.disposition),
               line_type      = coalesce(c.line_type,  nullif(btrim(coalesce(r->>'line_type','')), '')),
               phone_grade    = coalesce(c.phone_grade, nullif(btrim(coalesce(r->>'phone_grade','')), '')),
               dnc            = c.dnc or coalesce((r->>'dnc')::boolean, false),
               ghl_contact_id = coalesce(c.ghl_contact_id, nullif(btrim(coalesce(r->>'ghl_contact_id','')), ''))
         where normalize_phone(c.phone) = v_phone;
      end if;
    end if;

    if v_email is not null then
      select target_id into v_other from outreach_email where lower(btrim(email)) = v_email;
      if v_other is null then
        insert into outreach_email (target_id, email) values (v_tid, v_email);
        c_new_email := c_new_email + 1;
      elsif v_other <> v_tid then
        -- phone said target A, but the address already belongs to target B: leave it with B,
        -- flag A -- a human decides whether they are the same person.
        update outreach_targets set hold_reason = coalesce(hold_reason, 'email_on_other_target')
        where id = v_tid;
        c_held := c_held + 1;
        if jsonb_array_length(v_held) < 200 then
          v_held := v_held || jsonb_build_object(
            'name', coalesce(v_name, v_email), 'reason', 'email_on_other_target');
        end if;
      end if;
    end if;

    if v_mail_norm is not null then
      select target_id into v_other from outreach_mail
      where normalize_mail_address(mail_address) = v_mail_norm
        and coalesce(upper(btrim(mail_zip)), '') = coalesce(upper(btrim(v_mail_zip)), '');
      if v_other is null then
        insert into outreach_mail (target_id, mail_address, mail_city, mail_state, mail_zip)
        values (v_tid, v_mail, v_mail_city, v_mail_state, v_mail_zip);
        c_new_mail := c_new_mail + 1;
      end if;
      -- an address already on file (even under another target: family members share a mailbox)
      -- is simply not duplicated; postcards dedupe on the address by construction
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'list', v_list,
    'source', v_source,
    'rows', c_rows,
    'skipped_unreachable', c_skipped,
    'new', c_new,
    'existing', c_existing,
    'already_verified', c_verified,
    'new_phone_rows', c_new_phone,
    'new_email_rows', c_new_email,
    'new_mail_rows', c_new_mail,
    'matched_by_phone', c_by_phone,
    'matched_by_email', c_by_email,
    'matched_by_name_anchor', c_by_name,
    'held', c_held,
    'held_detail', v_held
  );
end;
$$;

comment on function import_outreach_targets(jsonb) is
  'THE ONLY DOOR into the outreach spine. p = {list, source, rows:[...]}. Matches each row '
  'phone -> email -> name+anchor (never name alone), never binds a new email onto a '
  'phone-matched target that holds a different one, resolves properties without guessing, and '
  'returns the import report (new / existing / already_verified / per-channel rows / held).';

commit;
