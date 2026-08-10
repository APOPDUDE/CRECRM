-- Two things Alex called after living with the buyers list for a day.
--
-- 1. "Schmuck" is a real category: someone who wants to own a building and has the
--    money, but does not know CRE. How you talk to them, what you send, and how much
--    hand-holding a deal takes are all different — so it is worth filtering on.
--
-- 2. Big box starts at 10,000 SF, not 100,000. In this market a 12k-SF box is already
--    out of small-bay territory, and with mid bay cut from the enum there was nothing
--    between them. Recorded as a comment so the rule lives next to the data.

alter type investment_strategy add value if not exists 'schmuck';

comment on type industrial_subclass is
  'Industrial product categories. Size rule: small_bay is under 10,000 SF, big_box is 10,000 SF and up.';
