-- 2026-08-19: composes one "CRM owner history" note body per GHL-linked contact, for
-- the backsync that makes CRM activity visible inside GHL. GHL notes cannot be
-- backdated, so dates live in the body text. GHL-sourced communications are EXCLUDED
-- (GHL already shows its own calls/texts/notes natively). The body carries BOTH
-- markers: '[via CRE CRM]' so the inbound note webhook (crm-note-sync) skips it, and
-- '[crm-history]' so re-runs find and UPDATE the same note instead of stacking new ones.
-- Delivered by n8n workflow ppUAJ8jCrhW6EkWa (kept inactive; POST /webhook/push-crm-history).
create or replace function public.ghl_history_note_payload()
returns table(contact_id uuid, ghl_contact_id text, note_body text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c        record;
  e        record;
  v_props  text;
  v_pcount int;
  v_body   text;
  v_lines  int;
  v_more   int;
  v_snip   text;
  v_disp   text;
begin
  for c in
    select ct.id, ct.ghl_contact_id as gid, ct.first_name, ct.last_name,
           ct.verified_at, ct.verified_by, ct.company_id, co.name as company_name
    from contacts ct
    left join companies co on co.id = ct.company_id
    where ct.ghl_contact_id is not null
  loop
    select string_agg(p.addr, ' · '), max(p.total)
      into v_props, v_pcount
    from (
      select pr.address || coalesce(', ' || pr.city, '') as addr,
             count(*) over () as total
      from properties pr
      where pr.owner_company_id = c.company_id
      order by pr.address
      limit 4
    ) p;

    v_body := '[via CRE CRM] [crm-history] CRM owner history — updated ' ||
              to_char(current_date, 'MM/DD/YY') || E'\n' ||
              trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) ||
              coalesce(' — ' || c.company_name, '') || E'\n' ||
              case
                when c.verified_at is not null
                  then 'Verified (' || coalesce(c.verified_by, 'spoke') || ') ' ||
                       to_char(c.verified_at, 'MM/DD/YY')
                else 'Not verified'
              end ||
              coalesce(E'\nProperties (' || v_pcount || '): ' || v_props ||
                       case when v_pcount > 4 then ' (+' || (v_pcount - 4) || ' more)' else '' end,
                       '') ||
              E'\n——— Activity from CRM ———';

    v_lines := 0;
    v_more  := 0;
    for e in
      select cm.channel, cm.direction, cm.disposition, cm.occurred_at,
             cm.subject, cm.body
      from communications cm
      where cm.contact_id = c.id
        and cm.source is distinct from 'ghl'
      order by cm.occurred_at desc
    loop
      if v_lines >= 40 or length(v_body) > 3400 then
        v_more := v_more + 1;
        continue;
      end if;

      v_disp := case e.disposition
        when 'f240bbac-87c9-4f6e-bf70-924b57d47db7' then 'connected'
        when 'b2cf5968-551e-4856-9783-52b3da59a7d0' then 'no answer'
        when '9d9162e7-6cf3-4944-bf63-4dff82258764' then 'left voicemail'
        when '73a0d17f-1163-4015-bdd5-ec830791da20' then 'left live message'
        else lower(coalesce(e.disposition, ''))
      end;

      v_snip := regexp_replace(coalesce(nullif(e.body, ''), e.subject, ''), '\s+', ' ', 'g');
      if v_snip like 'Terrakotta Voicemail Dropped%' then
        v_snip := '';
        if v_disp = '' then v_disp := 'voicemail dropped'; end if;
      elsif v_snip = 'Terrakotta Call' then
        v_snip := '';
      end if;
      if length(v_snip) > 180 then
        v_snip := left(v_snip, 179) || '…';
      end if;

      v_body := v_body || E'\n' || to_char(e.occurred_at, 'MM/DD/YY') || ' ' ||
                e.channel ||
                case e.direction when 'inbound' then ' in' when 'outbound' then ' out' else '' end ||
                case when v_disp <> '' then ' (' || v_disp || ')' else '' end ||
                case when v_snip <> '' then ': ' || v_snip else '' end;
      v_lines := v_lines + 1;
    end loop;

    if v_lines = 0 then
      v_body := v_body || E'\nNo non-GHL activity logged in CRM.';
    end if;
    if v_more > 0 then
      v_body := v_body || E'\n(+' || v_more || ' earlier items in CRM)';
    end if;

    contact_id := c.id;
    ghl_contact_id := c.gid;
    note_body := v_body;
    return next;
  end loop;
end $$;
