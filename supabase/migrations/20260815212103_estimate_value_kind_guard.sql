-- The last kind-blind comps reader: estimate_property_value's candidate CTE selected every comp
-- row in range (transfers included - proven: the test property's sale estimate moved
-- 4,751,000 -> 3,885,000 on the transfer backfill while all five guarded views held). Patch the
-- one candidate WHERE in place; the rest of the 18KB body is untouched (surgical replace on
-- pg_get_functiondef, asserted anchor). Verified restored to 4,751,000 / n=30 after apply.
do $patch$
declare
  src text;
  old_frag text := $f$where c.property_id<>v_subj.id
       and coalesce(c.executed_at,c.as_of_date,c.created_at::date) >= current_date - interval '6 years')$f$;
  new_frag text := $f$where c.property_id<>v_subj.id
       and c.kind in ('asking'::comp_kind,'executed'::comp_kind)
       and coalesce(c.executed_at,c.as_of_date,c.created_at::date) >= current_date - interval '6 years')$f$;
begin
  src := pg_get_functiondef('estimate_property_value(uuid, uuid[])'::regprocedure);
  if position(old_frag in src) = 0 then
    raise exception 'anchor fragment not found in estimate_property_value - aborting patch';
  end if;
  src := replace(src, old_frag, new_frag);
  execute src;
end
$patch$;
