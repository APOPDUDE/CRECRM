-- Repair the lease expirations the old import fabricated.
--
-- 234 executed lease comps carried the identical expiration date 2025-08-01. 72 of them
-- claimed a signature date AFTER that expiry and 67 ended before they started, which is
-- how the fabrication gave itself away. One further row was inconsistent without sitting
-- on the constant, so the predicate tests the contradiction rather than the magic date.
--
-- The rule (Alex, 2026-08-09): a lease ends a term after it STARTS. Commencement is the
-- start; the signature date stands in only when no commencement is recorded. Same
-- derivation as 20260809000003, applied to wrong values rather than to nulls.
--
-- THE TRAP: for most of these rows term_months was itself back-computed as the gap
-- between commencement and the fabricated date -- 66 distinct terms, from 2 to 189
-- months, every one landing on 2025-08-01 exactly. Such a term is not information about
-- the lease, it is the fake expiry wearing a different hat, and start + term simply
-- launders it back. Those rows are detected by that fingerprint and get null.
--
-- Terms beyond 25 years are not treated as terms either: the import appears to have put
-- tenure ("time in building") into term_months for some rows, and 1,135 months is 94
-- years, not a lease.
--
-- Null is the honest outcome where nothing survives. v_lease_comps still carries the
-- comp with its rate, size, commencement and signature date -- everything pricing needs
-- -- it just stops asserting an end date nobody knows. Single statement so the recompute
-- cannot re-flag its own output and undo itself.

update comps
set expiration_date = case
      when coalesce(commencement_date, executed_at) is not null
       and term_months between 1 and 300
       -- reject a back-derived term: adding it to the start lands on the constant
       and (coalesce(commencement_date, executed_at)
            + make_interval(months => term_months))::date <> date '2025-08-01'
      then (coalesce(commencement_date, executed_at)
            + make_interval(months => term_months)
            - interval '1 day')::date
      else null
    end
where deal_type = 'lease'
  and kind = 'executed'
  and expiration_date is not null
  and ( expiration_date = date '2025-08-01'
     or (executed_at is not null and expiration_date < executed_at)
     or (commencement_date is not null and expiration_date < commencement_date) );

-- A back-derived term contaminates the row whatever its expiry column happens to say,
-- so clear those too rather than leaving a date the term openly contradicts.
update comps
set expiration_date = null
where deal_type = 'lease'
  and kind = 'executed'
  and expiration_date is not null
  and term_months is not null
  and coalesce(commencement_date, executed_at) is not null
  and (coalesce(commencement_date, executed_at)
       + make_interval(months => term_months))::date = date '2025-08-01';
