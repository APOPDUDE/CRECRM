-- Email channel, part 2 of 4: the sequence template library.
--
-- WHY THIS EXISTS
-- Alex has run 15 Smartlead campaigns and 16,202 sends. The copy is good but it is trapped in
-- Smartlead, one campaign at a time, and every new campaign is rebuilt by hand. Worse, the merge
-- fields have drifted apart campaign by campaign -- {{City}} vs {{scity}}, {{location}} vs
-- {{address}} vs {{Street}} vs {{street_name}} -- and Smartlead does not validate custom_fields
-- keys, so a lead whose key casing differs just renders BLANK into a live email. Campaign 2985392
-- already carries a raw UUID as a field name plus lowercase duplicates of existing keys.
--
-- So this table does two jobs: it is the reusable copy library, and it pins ONE canonical merge
-- vocabulary that email_audience_build (part 3) emits and every template consumes. If a template
-- references a field outside that vocabulary the CHECK rejects it at write time rather than
-- letting a blank land in someone's inbox.
--
-- WHERE THE SEEDED COPY COMES FROM
-- Not invention -- measurement. Every send across the 8 campaigns that ever sent was pulled from
-- GET /campaigns/{id}/statistics (16,202 rows) and reply-attributed by seq_variant_id:
--
--   PURPOSE                             SENT    REPLIES   RATE
--   Off-market offer to owners          2,494       86    2.4-3.0%   <- the franchise
--   Expiring lease to occupiers           933       11    1.2%
--   Space-seeker to owners                680        7    0.7-2.2%
--   New listing to nearby occupiers     6,929       35    0.4-0.7%   <- weakest
--
--   WINNING FIRST-TOUCH SUBJECTS            REPLY RATE
--   "Off-Market Offer?"                       3.0%  (165 sends)
--   "Quick question re: {{street}}"           2.9%  (102)
--   "{{street}} - Off-Market Offer?"          2.8%  (395)
--   "{{first_name}}, quick question about
--    {{property_address}}"                    2.8%  (284)
--   "{{property_type}} on {{street}}?"        2.3%  (1,052 -- the most reliable sample)
--
--   LOSERS -- do not resurrect these
--   "CRE Activity Heating Up In {{city}}"     0.0%  (48)   market-news framing
--   "Grew up near your place..."              0.0%  (30)   personal-story framing
--   "{{first_name}} looking for more space?"  0.0%  (129)  vague, no specific asset
--   "New listing near {{company_name}}"       0.7%  (148)
--
-- Three rules fall out of that and are baked into the seeds:
--   1. Name the specific asset in the subject. Every winner contains a street, an address or a
--      property type. Every loser is generic.
--   2. Ask a question, and make it short. The 3.0% winner is two sentences.
--   3. Never lead with market commentary. It is the single clearest loser in the data.
--
-- The follow-up steps get SHORTER, not longer, and the last one offers an either/or rather than
-- another pitch -- that shape is lifted from Off Market Offer 2, the best-performing sequence.
--
-- COMPLIANCE, deliberately not optional. Roughly two of every three addresses in this book are
-- personal consumer mailboxes belonging to individual property owners, so these are commercial
-- messages to individuals and CAN-SPAM applies in full. Across 16,202 sends this account has
-- recorded ZERO unsubscribes -- not because nobody wanted out, but because no message has ever
-- carried an opt-out. Every seeded first touch ends with {{unsubscribe}} and every template
-- declares requires_postal_address, which the launcher refuses to send without.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'email_campaign_purpose') then
    create type email_campaign_purpose as enum (
      'off_market_seller',   -- owner -> would you sell
      'buyer_list',          -- proven buyer -> here is a deal
      'listing_to_nearby',   -- new listing -> occupiers around it
      'space_seeker',        -- a client needs space -> owners who might have it
      'expiring_lease',      -- their lease is ending -> represent them
      'general'
    );
  end if;
end $$;

create table if not exists email_sequence_templates (
  id                      uuid primary key default gen_random_uuid(),
  key                     text not null unique,
  name                    text not null,
  purpose                 email_campaign_purpose not null,
  description             text,
  -- The measured justification. Kept ON the row so the picker can show Alex why a template is
  -- recommended instead of asking him to remember 16,202 sends.
  evidence                text,
  -- [{seq_number, delay_days, variants:[{label, subject, body}]}]
  steps                   jsonb not null,
  requires_postal_address boolean not null default true,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint email_sequence_templates_steps_shape check (
    jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) > 0
  )
);

comment on table email_sequence_templates is
  'Reusable Smartlead sequences. The launcher renders these against the canonical merge '
  'vocabulary emitted by email_audience_build -- see email_merge_fields().';
comment on column email_sequence_templates.evidence is
  'The measured reply rates that justify this copy, so the picker can show its working.';
comment on column email_sequence_templates.steps is
  'Ordered steps. Each {seq_number, delay_days, variants:[{label, subject, body}]}. Several '
  'variants on step 1 = an A/B test; Smartlead rotates them. Follow-up steps normally carry one '
  'variant and an empty subject, which makes Smartlead thread them onto the first mail.';

-- ---------------------------------------------------------------------------
-- The canonical merge vocabulary. ONE list, referenced by the CHECK below, emitted verbatim as
-- Smartlead custom_fields by the audience builder. snake_case throughout, because the drift that
-- broke the old campaigns was casing ({{City}} vs {{scity}}).
-- ---------------------------------------------------------------------------
create or replace function email_merge_fields()
returns text[] language sql immutable as $$
  select array[
    'first_name','last_name','company_name','owner_name',
    'property_address','street','city','county','state','zip',
    'property_type','building_sf','land_acres','parcel_id',
    'unsubscribe','signature'
  ]
$$;

comment on function email_merge_fields is
  'The only merge fields a template may reference. Smartlead does NOT validate custom_fields '
  'keys -- an unknown token renders as empty text into a live email -- so the vocabulary is '
  'pinned here and enforced by email_sequence_templates_fields_valid.';

-- Reject a template that references a token the audience builder will never emit.
create or replace function email_template_unknown_fields(p_steps jsonb)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct tok), '{}')
  from (
    select (regexp_matches(
             coalesce(v->>'subject','') || ' ' || coalesce(v->>'body',''),
             '\{\{\s*([a-zA-Z0-9_]+)\s*\}\}', 'g'
           ))[1] as tok
    from jsonb_array_elements(p_steps) s,
         jsonb_array_elements(coalesce(s->'variants','[]'::jsonb)) v
  ) t
  where tok <> all (email_merge_fields())
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'email_sequence_templates_fields_valid'
  ) then
    alter table email_sequence_templates add constraint email_sequence_templates_fields_valid
      check (cardinality(email_template_unknown_fields(steps)) = 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'email_sequence_templates_updated_at'
  ) then
    create trigger email_sequence_templates_updated_at
      before update on email_sequence_templates
      for each row execute function set_updated_at();
  end if;
end $$;

alter table email_sequence_templates enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'email_sequence_templates'
      and policyname = 'email_sequence_templates_auth_all'
  ) then
    create policy email_sequence_templates_auth_all on email_sequence_templates
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Seeds
-- ---------------------------------------------------------------------------

-- 1. OFF-MARKET OFFER -- the proven franchise. 2.4-3.0% across 2,494 sends.
insert into email_sequence_templates (key, name, purpose, description, evidence, steps)
values (
  'off_market_seller_v1',
  'Off-market offer (owner)',
  'off_market_seller',
  'Ask an owner whether they would entertain an off-market offer. Shortest copy in the library, '
  'because that is what the data rewarded.',
  'Best-performing purpose on the account: 2.4-3.0% reply across 2,494 sends (Off Market Offer '
  '1/2/3). Subject "Off-Market Offer?" 3.0% (165 sends); "{{street}} - Off-Market Offer?" 2.8% '
  '(395); "Quick question re: {{street}}" 2.9% (102); "{{property_type}} on {{street}}?" 2.3% '
  '(1,052). The variant that led with market news ("CRE Activity Heating Up In {{city}}") got 0 '
  'replies from 48 sends and is deliberately absent.',
  $seq$[
    {"seq_number":1,"delay_days":1,"variants":[
      {"label":"A","subject":"Off-Market Offer?",
       "body":"{{first_name}} -\n\nI have a client interested in your property at {{property_address}} - have you considered selling?\n\nThanks,\n%signature%\n\n{{unsubscribe}}"},
      {"label":"B","subject":"{{street}} - Off-Market Offer?",
       "body":"{{first_name}} -\n\nClient asked me to reach out about your site on {{street}}.\n\nAny interest in an off-market offer?\n\nThanks,\n%signature%\n\n{{unsubscribe}}"},
      {"label":"C","subject":"{{property_type}} on {{street}}?",
       "body":"Good morning {{first_name}} -\n\nOur team works with buyers looking for {{property_type}} space in {{city}}. Your property on {{street}} came up in our research.\n\nAre you the current owner? If so, would love to connect briefly.\n\n%signature%\n\n{{unsubscribe}}"}
    ]},
    {"seq_number":2,"delay_days":3,"variants":[
      {"label":"A","subject":"",
       "body":"Hi {{first_name}} -\n\nThought to reach out again - happy to give you a free market evaluation on {{street}}, no strings.\n\nText, call or just reply here.\n\n%signature%"}
    ]},
    {"seq_number":3,"delay_days":7,"variants":[
      {"label":"A","subject":"",
       "body":"Hi {{first_name}},\n\nBefore I close this out - if selling is ever on the table, would you rather have a quick call, or should I send a preliminary price range first?\n\nEither one is fine, and no is a perfectly good answer.\n\n%signature%"}
    ]}
  ]$seq$::jsonb
) on conflict (key) do nothing;

-- 2. BUYER LIST -- what the "2810 buyers" tag actually is: people identified from deed records
--    as having BOUGHT comparable property. Credibility hook is what they already own.
insert into email_sequence_templates (key, name, purpose, description, evidence, steps)
values (
  'buyer_list_deal_v1',
  'New deal to a buyer list',
  'buyer_list',
  'Pitch a specific deal to proven buyers -- people pulled from deed records because they '
  'already bought something comparable. Leads with what they own, which no generic blast can do.',
  'No direct precedent on the account; built from the off-market winners, which prove that '
  'naming the specific asset in the subject is what moves reply rate (2.3-3.0% when named, '
  '0-0.7% when generic). The "you already own {{street}}" opener is the same specificity applied '
  'to the buyer side.',
  $seq$[
    {"seq_number":1,"delay_days":1,"variants":[
      {"label":"A","subject":"{{city}} deal - you bought on {{street}}",
       "body":"{{first_name}} -\n\nYou picked up {{property_address}}, so this may be in your wheelhouse.\n\nI have a {{property_type}} coming available in {{county}} County - happy to send the numbers if you want a look.\n\nWorth a note?\n\n%signature%\n\n{{unsubscribe}}"},
      {"label":"B","subject":"Off-market {{property_type}} - {{city}}",
       "body":"{{first_name}} -\n\nI have an off-market {{property_type}} in {{city}} and I am showing it to a short list of buyers who are already active here - you are on it because of {{street}}.\n\nWant the details?\n\n%signature%\n\n{{unsubscribe}}"}
    ]},
    {"seq_number":2,"delay_days":4,"variants":[
      {"label":"A","subject":"",
       "body":"{{first_name}} -\n\nCircling back on this one. I can send the full package, or just the price and the SF if that is faster.\n\n%signature%"}
    ]},
    {"seq_number":3,"delay_days":9,"variants":[
      {"label":"A","subject":"",
       "body":"{{first_name}},\n\nLast note on this deal. If it is not your box, tell me what is and I will only send you those.\n\n%signature%"}
    ]}
  ]$seq$::jsonb
) on conflict (key) do nothing;

-- 3. EXPIRING LEASE. 1.2% across 933 sends -- middling but a real, repeatable trigger.
insert into email_sequence_templates (key, name, purpose, description, evidence, steps)
values (
  'expiring_lease_v1',
  'Lease expiring (occupier)',
  'expiring_lease',
  'Reach an occupier whose lease is ending and offer to represent them at no cost to them.',
  '1.2% across 933 sends. Best subject named the property AND the benefit ("Your lease at '
  '{{property_address}} expires soon - free help available", 1.5%); the version that led with the '
  'month alone did 0.7%. Copy shortened here: the original three steps averaged 90 words and the '
  'whole-account pattern is that shorter wins.',
  $seq$[
    {"seq_number":1,"delay_days":1,"variants":[
      {"label":"A","subject":"Your lease at {{street}} - free help available",
       "body":"{{first_name}} -\n\nI believe {{company_name}}'s lease at {{property_address}} is coming up.\n\nWhether you want to relocate or just renegotiate where you are, my team does this daily and it costs you nothing - the landlord pays.\n\nWorth a quick call?\n\n%signature%\n\n{{unsubscribe}}"},
      {"label":"B","subject":"Quick question about your {{street}} lease",
       "body":"{{first_name}} -\n\nIs {{company_name}} staying at {{property_address}} when the lease is up?\n\nIf you are weighing options, I can show you everything available nearby - no cost to you, the landlord covers it.\n\n%signature%\n\n{{unsubscribe}}"}
    ]},
    {"seq_number":2,"delay_days":7,"variants":[
      {"label":"A","subject":"",
       "body":"{{first_name}} -\n\nCircling back. Rates below 20,000 SF have been firming up, so knowing your options early is worth real money at renewal.\n\nHappy to run a snapshot for {{street}}.\n\n%signature%"}
    ]},
    {"seq_number":3,"delay_days":10,"variants":[
      {"label":"A","subject":"",
       "body":"{{first_name}} -\n\nFinal check-in. If the renewal is handled, no worries at all.\n\nIf not, give me a shout - it is what we do.\n\n%signature%"}
    ]}
  ]$seq$::jsonb
) on conflict (key) do nothing;

-- 4. SPACE SEEKER -- a named client needs space; ask owners who might have it.
insert into email_sequence_templates (key, name, purpose, description, evidence, steps)
values (
  'space_seeker_v1',
  'Client needs space (to owners)',
  'space_seeker',
  'A real, named requirement looking for a home. Works because it is a specific ask about a '
  'specific building, not a solicitation.',
  '0.7-2.2% across 680 sends. The one-step Sarasota campaign that named the requirement and the '
  'property did 2.2%; the multi-step tenant campaign that opened with "looking for more space?" '
  'did 0.0% across 129 sends. Name the client requirement, name the building.',
  $seq$[
    {"seq_number":1,"delay_days":1,"variants":[
      {"label":"A","subject":"{{street}} - space available?",
       "body":"{{first_name}} -\n\nI represent a company looking for {{property_type}} space in {{city}}, and {{property_address}} fits what they need.\n\nIs any of it available, or likely to be?\n\n%signature%\n\n{{unsubscribe}}"},
      {"label":"B","subject":"Quick question about {{property_address}}",
       "body":"{{first_name}} -\n\nAre you the owner of {{property_address}}?\n\nI have a tenant actively looking in {{city}} and your building is the right size. Worth a conversation?\n\n%signature%\n\n{{unsubscribe}}"}
    ]},
    {"seq_number":2,"delay_days":5,"variants":[
      {"label":"A","subject":"",
       "body":"{{first_name}} -\n\nFollowing up - my client is still looking and {{street}} is still on my short list.\n\nEven a \"not now\" helps me stop bothering you.\n\n%signature%"}
    ]},
    {"seq_number":3,"delay_days":10,"variants":[
      {"label":"A","subject":"",
       "body":"{{first_name}} -\n\nClosing the loop. If {{property_address}} ever has space coming up, I would like to be the first call.\n\n%signature%"}
    ]}
  ]$seq$::jsonb
) on conflict (key) do nothing;

-- 5. LISTING TO NEARBY OCCUPIERS. The weakest purpose on the account (0.4-0.7% across 6,929
--    sends) -- kept because Alex runs it for every listing, rewritten hard against the evidence.
insert into email_sequence_templates (key, name, purpose, description, evidence, steps)
values (
  'listing_to_nearby_v1',
  'New listing to nearby occupiers',
  'listing_to_nearby',
  'Tell occupiers around a new listing that it exists. Lowest-yield purpose in the library -- '
  'run it, but expect a fraction of the off-market rate.',
  'WEAKEST purpose measured: 0.4% (1407 Whitfield, 5,402 sends) and 0.7% (3609 15th St, 1,527). '
  'Its best variant named the recipient company AND the ask ("{{first_name}} more space for '
  '{{company_name}}?", 2.0%); "New listing near {{company_name}}" did 0.7% and "{{first_name}} '
  'looking for more space?" did 0.0% across 129. The original five steps ran 100+ words each with '
  'market commentary - the single clearest loser in the data - so this is cut to three short '
  'steps and the commentary is gone.',
  $seq$[
    {"seq_number":1,"delay_days":1,"variants":[
      {"label":"A","subject":"{{first_name}} more space for {{company_name}}?",
       "body":"{{first_name}} -\n\nWe just brought space to market on {{street}}, right near you.\n\nIf {{company_name}} could use more room - or you know someone who could - I can send the flyer or set a 10-minute look.\n\n%signature%\n\n{{unsubscribe}}"},
      {"label":"B","subject":"Space on {{street}} - near {{company_name}}",
       "body":"{{first_name}} -\n\nNew {{property_type}} space just listed on {{street}}, a few doors from you.\n\nWanted you to hear it first. Want the details?\n\n%signature%\n\n{{unsubscribe}}"}
    ]},
    {"seq_number":2,"delay_days":4,"variants":[
      {"label":"A","subject":"",
       "body":"{{first_name}} -\n\nWorth knowing: having a broker represent you on a lease costs you nothing out of pocket - the landlord pays it.\n\nSo if {{company_name}} is anywhere near needing more space, or less, a 5-minute call is free.\n\n%signature%"}
    ]},
    {"seq_number":3,"delay_days":12,"variants":[
      {"label":"A","subject":"",
       "body":"{{first_name}} -\n\nOne more note and then I will leave you alone.\n\nThe space on {{street}} is getting activity. If the timing is wrong, no problem - I am a call away whenever it changes.\n\n%signature%"}
    ]}
  ]$seq$::jsonb
) on conflict (key) do nothing;

commit;
