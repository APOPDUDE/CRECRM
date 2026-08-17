-- Add an explicit per-row replace_address flag so the appraiser roll can REPAIR a broken stored
-- mailing street, not just fill a null one.
--
-- Needed because 2,635 owner rows held a mailing_address whose street segment had no street number
-- at all -- the city ended up in the street field ("VENICE, FL, 34292-1743") or it was a bare C/O
-- line. Those are unmailable, and the county roll has the real street ("740 COMMERCE DR STE 2").
--
-- The flag is per-row and OFF by default, so default behaviour stays fill-null-only. Nothing
-- overwrites a good address unless the caller has decided that specific row is broken.
create or replace function public.import_owner_addresses(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_filled   int := 0;
  v_replaced int := 0;
  v_seen     int;
begin
  select count(*) into v_seen from jsonb_array_elements(coalesce(p, '[]'::jsonb));

  with src as (
    select nullif(btrim(x->>'company_id'), '')          as cid_t,
           nullif(btrim(x->>'address'), '')             as addr,
           nullif(btrim(x->>'city'), '')                as city,
           nullif(btrim(x->>'state'), '')               as st,
           nullif(btrim(x->>'zip'), '')                 as zip,
           coalesce((x->>'replace_address')::boolean, false) as repl
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x
  ),
  upd_fill as (
    update companies c
    set mailing_address = coalesce(c.mailing_address, s.addr),
        mailing_city    = coalesce(c.mailing_city,    s.city),
        mailing_state   = coalesce(c.mailing_state,   s.st),
        mailing_zip     = coalesce(c.mailing_zip,     s.zip)
    from src s
    where s.cid_t is not null and not s.repl and c.id = s.cid_t::uuid
      and (c.mailing_address is null or c.mailing_city is null
           or c.mailing_state is null or c.mailing_zip is null)
    returning 1
  ),
  upd_repl as (
    update companies c
    set mailing_address = coalesce(s.addr, c.mailing_address),
        mailing_city    = coalesce(s.city, c.mailing_city),
        mailing_state   = coalesce(s.st,   c.mailing_state),
        mailing_zip     = coalesce(s.zip,  c.mailing_zip)
    from src s
    where s.cid_t is not null and s.repl and c.id = s.cid_t::uuid
    returning 1
  )
  select (select count(*) from upd_fill), (select count(*) from upd_repl)
    into v_filled, v_replaced;

  return jsonb_build_object('ok', true, 'seen', v_seen,
                            'filled', v_filled, 'replaced', v_replaced);
end $function$;

-- Applied 2026-08-17: repaired 2,635 broken owner streets from the roll. Owners whose mailing
-- street still has no street number: 2,635 -> 11.
