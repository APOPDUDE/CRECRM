-- Opt-out is what they SAID; email_status comes from a real reply; and some "replies" are bounces.
-- Applied live 2026-08-17; this file is the committed record.
--
-- Alex: "people who said fuck off or don't email me or remove me those people did unsubscribe and we
-- shouldn't email them again. And email status there should be verified ones -- people who responded
-- with interested or not interested emails have verified they own it."
--
-- 1. AN OPT-OUT IS WHAT THEY ASKED FOR, NOT WHAT THE CLASSIFIER CALLED IT.
--    Before this, email_opt_out_at was set only as a side effect of the categories Not Interested and
--    Do Not Contact. A reply categorised Wrong Person or left uncategorised that said "take me off
--    your list" sailed straight through and would have been mailed again. email_reply_is_optout()
--    reads the words. Its patterns are lifted VERBATIM from real replies in this account:
--      "Take me off your list"
--      "Fuck off and stop bothering me with your trash emails"
--      "Not interested, thank you. Please remove me from your list."
--      "Irrelevant to me sorry And pls remove me from all your databases"
--      "STOP EMAILING ME. I am not Eric."
--      "We don't own a property at that address. Please take me off of whatever list this is."
--      "I am not interested, Please stop sending me emails and remove me from your list."
--    10 addresses. Note the fifth and sixth: both are Wrong Person replies that ALSO asked to stop,
--    which is exactly the gap.
--
-- 2. A HUMAN REPLY IS BETTER DELIVERABILITY PROOF THAN ANY SMTP PROBE. Somebody typed a sentence
--    back, so the mailbox is real and monitored. That beats a vendor's guess, so a genuine reply sets
--    email_status='valid' on both the pool row and the contact. 164 pool rows, 161 contacts.
--
-- 3. BUT SOME "REPLIES" ARE BOUNCE NOTIFICATIONS, AND RULE 2 WOULD HAVE BELIEVED THEM.
--    Found while grounding rule 1's patterns in the real bodies -- 7 of the 206 inbound Smartlead
--    rows are NDRs that Smartlead recorded as replies:
--      "Your message to jack@attcusa.com couldn't be delivered. jack wasn't found at attcusa.com"
--      "meltingpot.com suspects your message is spam and rejected it"
--      "The group snider isn't set up to receive messages from alex@popcoadvisors.com"
--    Under rule 2 those 6 distinct addresses would have been stamped VALID and their "responder"
--    verification kept, when the mailbox actually rejected the mail. They are now email_status
--    'invalid' with email_bounced_at set, and the verified_at/verified_by='response' each had earned
--    from an NDR is CLEARED -- it was never a human. verified_by='response' went 122 -> 116.
--
-- All three are wired into apply_smartlead_event as well as backfilled, so the next reply is judged
-- the same way this history was. Order matters inside that function: the bounce-notice test runs
-- FIRST (it can cancel both the address and the person credit), then the opt-out test, then the
-- existing thin-reply / autoresponder / relay guards.

begin;

create or replace function email_reply_is_optout(p_text text)
returns boolean language sql immutable as $$
  select coalesce(p_text, '') ~* (
    '\mtake me off|\mremove me\M|remove me from|stop emailing|stop sending|stop contacting'
    '|do ?n.?t email|dont email|do ?n.?t contact|\munsubscribe\M|\mopt.?out\M'
    '|leave me alone|quit emailing|no longer wish|off your list|off of whatever list'
    '|out of your database|from all your databases|fuck off|piss off|stop bothering'
  )
$$;

comment on function email_reply_is_optout is
  'Did this human ask to stop being emailed, in their own words? Independent of the Smartlead '
  'category -- "take me off your list" on a Wrong Person reply is still an opt-out. Patterns are '
  'taken verbatim from real replies in this account.';

create or replace function email_reply_is_bounce_notice(p_text text)
returns boolean language sql immutable as $$
  select coalesce(p_text, '') ~* (
    'could ?n.?t be delivered|was ?n.?t found at|recipient unknown|delivery has failed'
    '|undeliverable|mailbox (is )?full|does not exist|no longer in service'
    '|rejected it|suspects your message is spam|sender action required|address not found'
    '|group .* is ?n.?t set up to receive|delivery status notification|failure notice'
  )
$$;

comment on function email_reply_is_bounce_notice is
  'Is this "reply" actually a bounce notification? Smartlead records NDRs as replies, and treating '
  'one as a human answer would stamp a dead address VALID and verify a person who was never there.';

commit;

-- NOTE: apply_smartlead_event was patched in place (anchored replace, assert-anchor-once) to call
-- both helpers immediately after email_reply_significant_text():
--
--   if not v_bounce and email_reply_is_bounce_notice(v_text) then
--     v_bounce := true; v_set_addr := false; v_set_person := false;
--     v_downgrade := 'bounce_notification_not_a_reply';
--   end if;
--   if not v_bounce and email_reply_is_optout(v_text) then
--     v_optout := true; v_ghl_tag := 'email-optout';
--   end if;
--
-- and the backfill over the 206 existing inbound rows set: opted_out_at / email_opt_out_at on the 10
-- who asked to stop; email_bounced_at + email_status='invalid' + cleared verification on the 6 NDR
-- addresses; email_status='valid' on every genuine responder; and email_status='invalid' on every
-- pool row that already carried a bounce from the harvest.
--
-- RESULT: pool 5,486 -- 164 valid, 167 invalid, 10 opted out, 5,061 never answered.
-- contacts -- 161 valid, 6 invalid, 22 opted out, 116 verified_by='response'.
