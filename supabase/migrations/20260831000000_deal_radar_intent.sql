-- Sale vs lease intent for radar listings, derived from the freeform title + price text.
create type deal_radar_intent as enum ('sale', 'lease', 'unknown');

alter table deal_radar
  add column listing_intent deal_radar_intent not null default 'unknown';

-- Lease and sale both key off explicit phrasing; ambiguous or absent => 'unknown'
-- so the human can categorize the "?" ones. \y is a Postgres word boundary.
create or replace function deal_radar_intent_of(p_text text)
returns deal_radar_intent language plpgsql immutable as $$
declare
  has_lease boolean;
  has_sale  boolean;
begin
  has_lease := p_text ~* '(\yfor\s+lease\y|\yfor\s+rent\y|\yfor\s+sublease\y|\ysublease\y|\yrent(al|ing)?\y|\yleas(e|ing)\y|/\s*mo(nth)?\y|\yper\s+month\y)';
  has_sale  := p_text ~* '(\yfor\s+sale\y|\yfsbo\y|\yselling\y|\yseller\s+financing\y|\ysale\y)';
  if has_lease and not has_sale then return 'lease';
  elsif has_sale and not has_lease then return 'sale';
  else return 'unknown';
  end if;
end $$;

-- Auto-label on insert (worker + any other writer). Respects an explicitly set value.
create or replace function deal_radar_set_intent()
returns trigger language plpgsql as $$
begin
  if new.listing_intent is null or new.listing_intent = 'unknown' then
    new.listing_intent := deal_radar_intent_of(
      coalesce(new.title, '') || ' ' || coalesce(new.raw_json->>'price', '')
    );
  end if;
  return new;
end $$;

create trigger deal_radar_intent_biu
  before insert on deal_radar
  for each row execute function deal_radar_set_intent();

-- Backfill what's already there.
update deal_radar
set listing_intent = deal_radar_intent_of(coalesce(title, '') || ' ' || coalesce(raw_json->>'price', ''));

create index deal_radar_intent_idx on deal_radar(listing_intent);
