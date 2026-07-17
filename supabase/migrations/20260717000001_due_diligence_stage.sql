-- Sale pursuits get a due-diligence stage (Alex, 2026-07-17). On sale boards the
-- pipeline reads Inquiring -> Touring -> PSA negotiation -> Due diligence -> Closed;
-- the terminal enum value stays 'executed' (relabeled "Closed" for sales) so every
-- executed-side mechanism — execute_pursuit, comps, payment ladder, checklist —
-- is untouched. Lease boards simply don't show the due_diligence column.
-- dd_expiration_date returns (the original schema had it; the redesign dropped it):
-- the drop-to-DD prompt writes it and creates a follow-up task for the deadline.

alter type pursuit_stage add value if not exists 'due_diligence' before 'executed';

alter table public.pursuits add column if not exists dd_expiration_date date;
