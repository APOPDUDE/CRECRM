-- Flip board: a pursuit carries its own lease/sale side.
--
-- Until now the board columns came from the PARENT (clients.deal_type on the tenant
-- board, listings.deal_type on the landlord board). A parent set to 'both' fell through
-- to the lease columns, so its for-sale pursuits lost PSA negotiation / Due diligence
-- entirely. Giving each pursuit its own side lets one client (or one listing) run two
-- independent boards that you flip between.
--
-- The side is derived in the DB, not the UI, because n8n / Apify / the intake RPCs
-- insert pursuits without ever touching the app.

alter table pursuits add column deal_type deal_type;

-- Which side a pursuit belongs on:
--   1. an unambiguous client (lease-only or sale-only) decides it outright;
--   2. otherwise read the property's own asking terms -- a sale asking price means the
--      sale board, a lease asking rate means the lease board;
--   3. ambiguous or unpriced falls back to lease.
create or replace function derive_pursuit_deal_type(p_client_id uuid, p_property_id uuid)
returns deal_type
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select c.deal_type from clients c
      where c.id = p_client_id and c.deal_type in ('lease', 'sale')),
    (select case
              when bool_or(k.deal_type = 'sale' and k.sale_price is not null)
                then 'sale'::deal_type
              when bool_or(k.deal_type = 'lease' and k.asking_lease_rate_psf is not null)
                then 'lease'::deal_type
            end
       from comps k
      where k.property_id = p_property_id and k.kind = 'asking'),
    'lease'::deal_type
  );
$$;

-- Fill the side on any write that leaves it null (the automation path). An explicit
-- 'lease'/'sale' from the UI always wins. BEFORE triggers run ahead of the NOT NULL
-- check, so an insert that omits the column still satisfies it.
create or replace function pursuits_default_deal_type()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.deal_type is null then
    new.deal_type := derive_pursuit_deal_type(new.client_id, new.property_id);
  end if;
  return new;
end $$;

create trigger pursuits_deal_type_default
  before insert or update on pursuits
  for each row execute function pursuits_default_deal_type();

update pursuits p
   set deal_type = derive_pursuit_deal_type(p.client_id, p.property_id)
 where p.deal_type is null;

alter table pursuits alter column deal_type set not null;

-- 'both' is a valid answer for a client or a listing, never for a single pursuit --
-- a pursuit is one property being leased or bought, not both.
alter table pursuits
  add constraint pursuits_deal_type_is_one_side check (deal_type <> 'both');

-- The executed comp now takes its side from the pursuit instead of guessing from the
-- client + whether a sale price happened to be typed in.
CREATE OR REPLACE FUNCTION public.execute_pursuit(p_pursuit_id uuid, p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_comp uuid; v_owner uuid; v_prop uuid; v_company uuid; v_deal public.deal_type; v_sf int;
        v_fee numeric; v_client uuid;
begin
  update pursuits set stage='executed',
    executed_date = coalesce((nullif(p->>'executed_date',''))::date, executed_date, current_date),
    actual_fee    = coalesce((nullif(p->>'actual_fee',''))::numeric, actual_fee)
  where id = p_pursuit_id
  returning owner_id, property_id, client_id, actual_fee into v_owner, v_prop, v_client, v_fee;
  if v_owner is null then raise exception 'pursuit % not found', p_pursuit_id; end if;

  update clients set actual_fee = coalesce(v_fee, actual_fee) where id = v_client;

  select pu.deal_type, c.company_id into v_deal, v_company
  from pursuits pu join clients c on c.id = pu.client_id where pu.id = p_pursuit_id;
  select building_sf into v_sf from properties where id = v_prop;
  if v_deal is null or v_deal = 'both' then
    v_deal := case when nullif(p->>'sale_price','') is not null then 'sale' else 'lease' end;
  end if;

  insert into comps (owner_id, property_id, pursuit_id, tenant_company_id, deal_type, kind,
    executed_lease_rate_psf, lease_structure, term_months, free_rent_months, ti_psf, escalations,
    commencement_date, expiration_date, sale_price, cap_rate_pct, commission_fee, sf, executed_at, source)
  values (v_owner, v_prop, p_pursuit_id, v_company, v_deal, 'executed',
    nullif(p->>'executed_rate_psf','')::numeric, (nullif(p->>'lease_structure',''))::public.lease_structure,
    nullif(p->>'term_months','')::int, nullif(p->>'free_rent_months','')::numeric, nullif(p->>'ti_psf','')::numeric,
    nullif(p->>'escalations',''), nullif(p->>'commencement_date','')::date, nullif(p->>'lease_expiration','')::date,
    nullif(p->>'sale_price','')::numeric, nullif(p->>'cap_rate_pct','')::numeric, v_fee,
    v_sf, coalesce((nullif(p->>'executed_date',''))::date, current_date), 'manual')
  on conflict (pursuit_id) where pursuit_id is not null
  do update set executed_lease_rate_psf=excluded.executed_lease_rate_psf, lease_structure=excluded.lease_structure,
    term_months=excluded.term_months, free_rent_months=excluded.free_rent_months, ti_psf=excluded.ti_psf,
    escalations=excluded.escalations, commencement_date=excluded.commencement_date, expiration_date=excluded.expiration_date,
    sale_price=excluded.sale_price, cap_rate_pct=excluded.cap_rate_pct, deal_type=excluded.deal_type,
    commission_fee=coalesce(excluded.commission_fee, comps.commission_fee),
    sf=coalesce(excluded.sf, comps.sf), executed_at=excluded.executed_at, updated_at=now()
  returning id into v_comp;

  if coalesce((p->>'close_client')::boolean, false) then
    update clients set status='closed'
    where id = v_client and status in ('searching','negotiating');
  end if;
  if coalesce((p->>'close_listing')::boolean, false) then
    update listings set stage='closed' where property_id = v_prop and status='active';
    update pursuits set stage='passed'
      where property_id = v_prop and id <> p_pursuit_id and stage not in ('executed','passed');
  end if;

  return jsonb_build_object('pursuit_id', p_pursuit_id, 'comp_id', v_comp);
end $function$;
