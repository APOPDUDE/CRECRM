-- The tour gets an outcome, and the outcome leaves something behind on the property.
--
-- Touring becomes "Scheduled" (a label change only — the enum value stays `touring`, so
-- every stamped tour_date, task and rank keeps working), and a new `interested` column
-- sits after it. The board then reads the real sequence: the tour is booked, it happens,
-- and the tenant either wants the building or does not.
--
-- "Not interested" is not a new stage. It is a pass, and passes already have a rail with
-- restore and delete built in; a second rail would split one idea across two places. What
-- distinguishes a post-tour rejection from any other pass is that the pursuit carries a
-- tour_date, which the card reads to show a "Toured" chip.
--
-- notes.property_id (Alex): the reason belongs to the BUILDING, not to the deal that
-- happened to surface it. A year from now the useful question is "what do we know about
-- this address", and the answer should include that a tenant walked it and passed. The
-- note keeps pursuit_id too, so the property page can say which deal produced it —
-- context without losing provenance.
--
-- Position matters: `before 'negotiation'` keeps the enum's own ordering aligned with the
-- board's left-to-right order, which hottestStage and every stage comparison rely on.

alter type pursuit_stage add value if not exists 'interested' before 'negotiation';

-- Tour feedback is a distinct kind of note so the property page can surface it as such
-- rather than burying it among ordinary notes.
alter type note_kind add value if not exists 'tour';
