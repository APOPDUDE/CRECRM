-- Owner portfolios, part 2: form them automatically (2026-09-03).
--
-- Alex: "when we get a verified contact the rest of the portfolio gets verified" -- and
-- "we should match people based on mailing address, careful if it's a lawyer or whatever".
--
-- Part 1 (20260902150000) made every read look across a portfolio. This makes the
-- portfolio FORM on its own, by the same rule the seed used, whenever the evidence lands:
--   * a contact becomes verified (or gets seated) at an owning entity, or
--   * a new owning entity arrives with a mailing address (county import / intake).
-- The Hyer case showed the seed's key was too literal: "4161 E 7TH AVE" and
-- "4161 E 7th Ave, Tampa, Fl, 33605-4601" are one mailbox. `mailing_street_key()` strips
-- city / state / zip and punctuation so both read 4161E7THAVE; it is a stored generated
-- column so the join is an index seek.
--
-- The guard rails (unchanged in spirit, now enforced in one place):
--   * street addresses only (starts with a number); no c/o, PO box, tax dept, attn,
--     management, realty, trust, law / CPA / title mailboxes -- those serve unrelated owners;
--   * a member whose NAME says trust services / law / title / tax / accounting marks the
--     whole mailbox as shared;
--   * 2-6 entities per mailbox (a 9- or 14-entity suite is a manager, not a principal);
--   * link only when someone in the group is already verified or already in a portfolio --
--     an unverified mailbox stays ungrouped until a human reaches one of them.
-- "Not the same owner?" on the property page still undoes any link.

-- ---------------------------------------------------------------------------
-- 1. One definition of "the mailbox"
-- ---------------------------------------------------------------------------
create or replace function public.mailing_street_key(p_addr text, p_city text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(regexp_replace(
    regexp_replace(
      regexp_replace(
        replace(upper(coalesce(p_addr, '')), upper(coalesce(nullif(p_city, ''), E'§§')), ' '),
        '(\s\d{5}(-\d{4})?)+\s*$', ' '),          -- trailing zip(s), incl. the county's doubled zip
      '\m(FL|FLORIDA)\M', ' ', 'g'),
    '[^A-Z0-9]', '', 'g'), '');
$$;

comment on function public.mailing_street_key(text, text) is
  'Street line of a mailing address as a join key: city/state/zip and punctuation removed. "4161 E 7TH AVE" = "4161 E 7th Ave, Tampa, Fl, 33605-4601".';

alter table public.companies
  add column if not exists mailing_key text
  generated always as (public.mailing_street_key(mailing_address, mailing_city)) stored;
create index if not exists companies_mailing_key_idx
  on public.companies (mailing_key) where mailing_key is not null;

-- A mailbox that serves unrelated owners: agents, PO boxes, trustees, law/tax firms.
create or replace function public.is_shared_mailbox(p_addr text, p_name text default null)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(p_addr, '') !~ '^\s*\d'
      or coalesce(p_addr, '') ~* '(c/o|\bcare of\b|p\.?\s?o\.?\s?box|\bbox\b|\btax\b|\bdept\b|\battn\b|\bmanagement\b|\bmgmt\b|\bproperties\b|\brealty\b|\btrust|\bl\.?l\.?p\b|\besq\b|\blaw\b|\battorney|\bp\.?a\.?\b|\bcpa\b|\btitle\b)'
      or coalesce(p_name, '') ~* '(trust services|\blaw\b|attorney|\besq\b|\btitle\b|property tax|\btax\b|account|\bcpa\b|\bp\.?a\.?$)';
$$;

-- ---------------------------------------------------------------------------
-- 2. The rule, callable from anywhere: group this entity with its mailbox siblings
-- ---------------------------------------------------------------------------
create or replace function public.auto_link_owner_portfolio(p_company uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_self   companies%rowtype;
  v_ids    uuid[];
  v_n      int;
  v_pid    uuid;
  v_sib    uuid;
begin
  select * into v_self from companies where id = p_company;
  if v_self.id is null or v_self.type <> 'owning_entity' or v_self.mailing_key is null
     or length(v_self.mailing_key) < 6 or is_shared_mailbox(v_self.mailing_address, v_self.name) then
    return v_self.portfolio_id;
  end if;

  -- the mailbox: self + every other owning entity with the same street key
  select array_agg(c.id), count(*) into v_ids, v_n
  from companies c
  where c.type = 'owning_entity' and c.mailing_key = v_self.mailing_key;
  if v_n < 2 or v_n > 6 then
    return v_self.portfolio_id;
  end if;

  -- one agent-looking member poisons the whole mailbox
  if exists (select 1 from companies c where c.id = any(v_ids) and is_shared_mailbox(c.mailing_address, c.name)) then
    return v_self.portfolio_id;
  end if;

  -- evidence: someone here is reached, or the mailbox is already a known portfolio
  if not exists (select 1 from contacts ct where ct.company_id = any(v_ids) and ct.verified_at is not null and not ct.archived)
     and not exists (select 1 from companies c where c.id = any(v_ids) and c.portfolio_id is not null) then
    return null;
  end if;

  v_pid := v_self.portfolio_id;
  foreach v_sib in array v_ids loop
    if v_sib <> v_self.id then
      v_pid := link_owner_portfolio(v_self.id, v_sib);
    end if;
  end loop;
  return v_pid;
end $$;

revoke execute on function public.auto_link_owner_portfolio(uuid) from public, anon;
grant execute on function public.auto_link_owner_portfolio(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Fire it when the evidence lands
-- ---------------------------------------------------------------------------
create or replace function public.contacts_auto_link_portfolio_tg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform auto_link_owner_portfolio(new.company_id);
  return null;
end $$;

drop trigger if exists contacts_auto_link_portfolio on public.contacts;
create trigger contacts_auto_link_portfolio
  after insert or update of verified_at, company_id on public.contacts
  for each row
  when (new.verified_at is not null and new.company_id is not null)
  execute function public.contacts_auto_link_portfolio_tg();

create or replace function public.companies_auto_link_portfolio_tg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform auto_link_owner_portfolio(new.id);
  return null;
end $$;

-- Only address columns: linking writes portfolio_id, which does not re-fire this.
drop trigger if exists companies_auto_link_portfolio on public.companies;
create trigger companies_auto_link_portfolio
  after insert or update of mailing_address, mailing_city on public.companies
  for each row
  when (new.type = 'owning_entity' and new.mailing_address is not null)
  execute function public.companies_auto_link_portfolio_tg();

-- ---------------------------------------------------------------------------
-- 4. Backfill with the sharper key: every owning entity that holds a verified person.
--    Pre-image of portfolio_id for the whole table, so this pass reverses cleanly:
--      update companies c set portfolio_id = r.portfolio_id
--        from _rollback_company_portfolio_pre_20260903 r where r.company_id = c.id;
-- ---------------------------------------------------------------------------
create table if not exists public._rollback_company_portfolio_pre_20260903 as
  select id as company_id, portfolio_id, now() as captured_at from public.companies;
alter table public._rollback_company_portfolio_pre_20260903 enable row level security;

select count(*) filter (where auto_link_owner_portfolio(c.id) is not null) as linked
from public.companies c
where c.type = 'owning_entity'
  and exists (select 1 from public.contacts ct where ct.company_id = c.id and ct.verified_at is not null and not ct.archived);
