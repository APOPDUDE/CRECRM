-- The contact book is bigger than one PostgREST page (Alex 2026-08-12).
--
-- Every contact search in the app -- the Contacts page, the contact picker, the phone autofill,
-- the duplicate-phone hint -- ran the SAME query: fetch contacts ordered by first_name, then
-- filter the result in JavaScript. PostgREST caps a response at 1000 rows, so that fetch has
-- silently been the first 1000 contacts alphabetically. The 1000th is named "Dan". Everyone from
-- there to the end of the alphabet -- 738 live contacts at or after "Saul" alone -- could not be
-- found by any search in the app, by name, phone, email or company. Nothing errored; the search
-- just said no matches.
--
-- Search moves into Postgres, over the whole table. It also fixes two things the JS filter got
-- wrong even within its 1000 rows:
--   * phone: the filter compared the typed string to the stored string, so "(813) 785-2056" and
--     "8137852056" missed a contact stored as "813-785-2056". Digits are compared to digits.
--   * multi-word: "saul ii" matched no single column. Each word now has to appear SOMEWHERE in
--     the contact, not all in the same field.
--
-- Archived contacts are searchable here and deliberately so. They are hidden from the browse list
-- because they are import padding with no relationship evidence (20260810000001), but "I know this
-- person exists and cannot find them" is exactly the case archiving must not break. They come back
-- last and the UI marks them.

create or replace function search_contacts(
  p_query text,
  p_limit int default 50,
  p_include_archived boolean default true
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  title text,
  email text,
  phone text,
  company_id uuid,
  company_name text,
  archived boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with q as (
    select
      lower(btrim(coalesce(p_query, ''))) as text_q,
      regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g') as digits
  ),
  scoped as (
    select
      c.id, c.first_name, c.last_name, c.title, c.email, c.phone,
      c.company_id, co.name as company_name, c.archived, c.created_at, c.updated_at,
      -- the phone goes in twice, formatted and as bare digits, so a word like "813" hits
      -- either way round
      lower(concat_ws(' ', c.first_name, c.last_name, c.title, c.email, c.phone,
                      regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), co.name)) as haystack,
      lower(btrim(concat_ws(' ', c.first_name, c.last_name))) as full_name,
      regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') as phone_digits
    from contacts c
    left join companies co on co.id = c.company_id
    where p_include_archived or not c.archived
  )
  select s.id, s.first_name, s.last_name, s.title, s.email, s.phone,
         s.company_id, s.company_name, s.archived, s.created_at, s.updated_at
  from scoped s, q
  where q.text_q <> ''
    and (
      -- a run of digits is a phone search whatever punctuation surrounds it
      (length(q.digits) >= 4 and s.phone_digits like '%' || q.digits || '%')
      -- otherwise every word has to appear somewhere on the contact
      or not exists (
        select 1 from unnest(string_to_array(q.text_q, ' ')) tok
        where btrim(tok) <> '' and position(btrim(tok) in s.haystack) = 0
      )
    )
  order by
    s.archived,                                       -- live people first
    case
      when s.full_name = q.text_q then 0              -- exact name
      when s.full_name like q.text_q || '%' then 1    -- name starts with what was typed
      when position(q.text_q in s.full_name) > 0 then 2
      else 3                                          -- matched on phone/email/company
    end,
    s.full_name,
    s.id
  limit greatest(coalesce(p_limit, 50), 1);
$function$;

comment on function search_contacts(text, int, boolean) is
  'Search the whole contact book by name, phone (digits, any formatting), email, title or '
  'company. Every word must appear somewhere on the contact. Archived contacts match but sort '
  'last. Runs as the caller, so contacts RLS applies.';

-- Invoker-rights and RLS-protected, but the house rule is that RPCs are not anon-callable.
revoke execute on function search_contacts(text, int, boolean) from public, anon;
grant execute on function search_contacts(text, int, boolean) to authenticated;
