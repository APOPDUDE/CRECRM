-- Audit cleanup (safe quick wins):
-- 1. county_lookup was the only public table with RLS disabled (Supabase advisor lint 0013
--    ERROR + violates the foundation rule "RLS enabled on every table"). It holds non-sensitive
--    city->county reference data and is read by the set_property_county() trigger. Enable RLS and
--    mirror the uniform auth-full-access policy used on every other public table. The trigger that
--    reads it runs either as authenticated (covered by this policy) or inside a SECURITY DEFINER
--    RPC / service role (owner -> bypasses RLS), so county population is preserved on every path.
-- 2. Pin search_path on the four SECURITY INVOKER helper/trigger functions flagged by advisor
--    lint 0011 (function_search_path_mutable). No behavior change; clears the four standing warns.

alter table public.county_lookup enable row level security;

create policy county_lookup_auth_all on public.county_lookup
  for all to authenticated using (true) with check (true);

alter function public.normalize_phone(p text)   set search_path = public, pg_temp;
alter function public.format_phone(p text)       set search_path = public, pg_temp;
alter function public.set_contact_phone()        set search_path = public, pg_temp;
alter function public.set_property_county()       set search_path = public, pg_temp;
