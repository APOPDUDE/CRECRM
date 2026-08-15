-- STAGE 2b end-game (2d): resolve_communication_identity loses its owners-era blocks.
-- Sets contact_id and owner_company_id only (communications.owner_id is being dropped).
-- Contact tie-break: prefer the row seated at a company — that is the record the owner
-- page surfaces (the old rule preferred owner-linked rows; the seat is its successor).

create or replace function public.resolve_communication_identity()
returns trigger
language plpgsql
as $function$
declare
  digits text;
begin
  if new.phone is null then return new; end if;
  digits := regexp_replace(new.phone, '\D', '', 'g');
  if length(digits) = 11 and digits like '1%' then digits := substr(digits, 2); end if;
  if length(digits) <> 10 then return new; end if;

  if new.contact_id is null then
    -- If several contacts share the number (merged twins exist), prefer the one that is
    -- seated at a company -- that is the record the owner page will surface.
    select c.id into new.contact_id
    from contacts c
    where regexp_replace(coalesce(c.phone,''), '\D', '', 'g') = digits
    order by (c.company_id is not null) desc, c.created_at asc
    limit 1;
  end if;

  if new.owner_company_id is null and new.contact_id is not null then
    select c.company_id into new.owner_company_id
    from contacts c
    where c.id = new.contact_id
      and c.company_id is not null
      and exists (select 1 from properties p where p.owner_company_id = c.company_id);
  end if;

  return new;
end $function$;
