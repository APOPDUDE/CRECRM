-- Fill in the lease expirations that were always computable.
--
-- A lease with a start and a term already states when it ends; leaving the column null
-- just hid those comps from every expiry view. Written into comps rather than derived
-- in a view so the property detail pages see them too.
--
-- End date is start + term - 1 day: a 12-month lease commencing 1 Jan runs through
-- 31 Dec, not 1 Jan the following year.
--
-- Commencement is preferred over signature where both exist, because a lease starts
-- when it commences; the signature is only a stand-in when nothing better is recorded.
-- These stay verified = false, as they are inferred rather than read off a document.

update comps
set expiration_date = (coalesce(commencement_date, executed_at)
                       + make_interval(months => term_months)
                       - interval '1 day')::date
where deal_type = 'lease'
  and kind = 'executed'
  and expiration_date is null
  and term_months is not null
  and coalesce(commencement_date, executed_at) is not null;
