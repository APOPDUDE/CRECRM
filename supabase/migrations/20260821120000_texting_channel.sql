-- VA cold-texting silo, part 1 of 2: the texting channel itself.
--
-- A new channel child on the outreach spine (outreach_texts, mirroring outreach_calls),
-- a send queue (text_sends) with every merge field resolved at enqueue, a full transcript
-- (text_messages), and -- the point of the whole design -- every compliance rule living IN
-- Postgres: suppressions, DNC scrubs, quiet hours by recipient area code, the FTSA
-- calls+texts combined touch cap, per-line ramp caps, and a BEFORE INSERT gate trigger on
-- outbound messages that n8n cannot be talked past. send_authorizations is the court-ready,
-- immutable record of every gate result at the moment of send.
--
-- Identity is normalize_phone(), same as outreach_calls and outreach_targets.
-- Part 2 (20260821120001) walls the VA off from the rest of the book.

begin;

--------------------------------------------------------------------------------
-- Enums
--------------------------------------------------------------------------------

create type text_send_status as enum
  ('draft','approved','queued','sending','sent','delivered','failed','blocked');
create type msg_direction as enum ('inbound','outbound');
create type msg_protocol as enum ('imessage','sms','rcs','unknown');
create type suppression_reason as enum
  ('federal_dnc','state_dnc','litigator','wrong_person','opt_out','hostile',
   'carrier_block','said_no','manual');
create type triage_label as enum
  ('owner_yes','wrong_person','not_interested','opt_out','hostile_legal',
   'question','autoreply','unknown');

--------------------------------------------------------------------------------
-- Tables
--------------------------------------------------------------------------------

-- Who we must never text (or call). NULL expires_at = permanent.
create table phone_suppressions (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  reason suppression_reason not null,
  source text not null,
  evidence jsonb,
  suppressed_at timestamptz not null default now(),
  expires_at timestamptz,          -- federal/state DNC: now()+30d; said_no: now()+12mo; else NULL
  created_at timestamptz not null default now()
);
create unique index phone_suppressions_phone_reason_key
  on phone_suppressions (normalize_phone(phone), reason);

-- Latest DNC-scrub verdict per phone (30-day freshness enforced by the gate, not here).
create table phone_scrubs (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  federal_dnc boolean,
  state_dnc boolean,
  litigator boolean,
  line_type text,
  rnd_ok boolean,
  vendor text not null,
  raw jsonb,
  scrubbed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index phone_scrubs_phone_key on phone_scrubs (normalize_phone(phone));

-- The texting channel child on the spine, one row per phone (mirrors outreach_calls).
create table outreach_texts (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references outreach_targets(id) on delete cascade,
  phone text not null,
  blooio_chat_id text,
  protocol msg_protocol not null default 'unknown',
  last_outbound_at timestamptz,
  last_inbound_at timestamptz,
  triage triage_label,
  triage_confidence numeric(4,3),
  queue_state text not null default 'none'
    check (queue_state in ('none','awaiting_va','done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index outreach_texts_phone_key on outreach_texts (normalize_phone(phone));
create index outreach_texts_target_idx on outreach_texts (target_id);
create index outreach_texts_queue_idx on outreach_texts (queue_state)
  where queue_state = 'awaiting_va';

create table text_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  template text not null,
  status text not null default 'draft'
    check (status in ('draft','active','paused','done')),
  daily_cap int not null default 25,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The queue. body holds the FINAL text -- merge fields are resolved at enqueue,
-- Blooio sends verbatim. What was approved is what goes out.
create table text_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references text_campaigns(id),
  target_id uuid references outreach_targets(id),
  phone text not null,
  body text not null,
  status text_send_status not null default 'draft',
  blocked_reason text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz,
  blooio_message_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index text_sends_status_idx on text_sends (status);
create unique index text_sends_campaign_phone_key
  on text_sends (campaign_id, normalize_phone(phone))
  where campaign_id is not null;

-- The transcript: every message in either direction, forever.
create table text_messages (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  direction msg_direction not null,
  body text,
  protocol msg_protocol not null default 'unknown',
  status text not null,
  blooio_message_id text unique,
  campaign_id uuid references text_campaigns(id),
  send_id uuid references text_sends(id),
  error text,
  raw jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index text_messages_phone_idx on text_messages (normalize_phone(phone));
create index text_messages_created_idx on text_messages (created_at desc);
create index text_messages_send_idx on text_messages (send_id);

-- Court-ready audit: the exact gate results under which each send was authorized.
-- Immutable: no UPDATE/DELETE policy exists and the privileges are revoked below.
create table send_authorizations (
  id uuid primary key default gen_random_uuid(),
  send_id uuid not null references text_sends(id),
  phone text not null,
  scrubbed_at timestamptz not null,
  scrub_vendor text,
  checks jsonb not null,
  template_hash text,
  approved_by uuid,
  authorized_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index send_authorizations_send_idx on send_authorizations (send_id);

-- Singleton kill-switch + quiet hours + ramp.
-- quiet_cutoff is 19:30, not 20:00: delivery-lag buffer under the FTSA 8pm line.
create table texting_settings (
  id int primary key check (id = 1),
  paused boolean not null default true,
  quiet_start time not null default '08:00',
  quiet_cutoff time not null default '19:30',
  per_line_daily_cap int not null default 100,
  ramp_started_on date,   -- NULL = sending never enabled; effective cap = least(per_line_daily_cap, 20 + 10*days)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into texting_settings (id) values (1) on conflict do nothing;

-- NANP area code -> IANA timezone, for recipient-local quiet hours.
-- Split-timezone codes get ONE zone (the population majority); unknown codes are
-- handled conservatively by texting_quiet_ok(), not by this table.
-- Known compromise: 850 (FL panhandle) is mapped Central (Pensacola/Panama City
-- majority); Tallahassee (Eastern) sits inside it -- the 19:30 cutoff buffer absorbs
-- most of the skew, noted here on purpose.
create table area_code_timezones (
  area_code text primary key,
  tz text not null,
  created_at timestamptz not null default now()
);

insert into area_code_timezones (area_code, tz) values
-- ============ Eastern: America/New_York ============
-- Connecticut
('203','America/New_York'),('475','America/New_York'),('860','America/New_York'),('959','America/New_York'),
-- Delaware
('302','America/New_York'),
-- District of Columbia
('202','America/New_York'),('771','America/New_York'),
-- Florida (all Eastern except 850 + its 448 overlay -> Central below)
('239','America/New_York'),('305','America/New_York'),('321','America/New_York'),('352','America/New_York'),
('386','America/New_York'),('407','America/New_York'),('561','America/New_York'),
('645','America/New_York'),('656','America/New_York'),('689','America/New_York'),('727','America/New_York'),
('728','America/New_York'),('754','America/New_York'),('772','America/New_York'),('786','America/New_York'),
('813','America/New_York'),('863','America/New_York'),('904','America/New_York'),('941','America/New_York'),
('954','America/New_York'),
-- Georgia
('229','America/New_York'),('404','America/New_York'),('470','America/New_York'),('478','America/New_York'),
('678','America/New_York'),('706','America/New_York'),('762','America/New_York'),('770','America/New_York'),
('912','America/New_York'),('943','America/New_York'),
-- Indiana (Eastern part; 219 -> Central below)
('260','America/New_York'),('317','America/New_York'),('463','America/New_York'),('574','America/New_York'),
('765','America/New_York'),('812','America/New_York'),('930','America/New_York'),
-- Kentucky (Eastern part)
('502','America/New_York'),('606','America/New_York'),('859','America/New_York'),
-- Maine
('207','America/New_York'),
-- Maryland
('227','America/New_York'),('240','America/New_York'),('301','America/New_York'),('410','America/New_York'),
('443','America/New_York'),('667','America/New_York'),
-- Massachusetts
('339','America/New_York'),('351','America/New_York'),('413','America/New_York'),('508','America/New_York'),
('617','America/New_York'),('774','America/New_York'),('781','America/New_York'),('857','America/New_York'),
('978','America/New_York'),
-- Michigan (majority Eastern, incl. 906 UP)
('231','America/New_York'),('248','America/New_York'),('269','America/New_York'),('313','America/New_York'),
('517','America/New_York'),('586','America/New_York'),('616','America/New_York'),('679','America/New_York'),
('734','America/New_York'),('810','America/New_York'),('906','America/New_York'),('947','America/New_York'),
('989','America/New_York'),
-- New Hampshire
('603','America/New_York'),
-- New Jersey
('201','America/New_York'),('551','America/New_York'),('609','America/New_York'),('640','America/New_York'),
('732','America/New_York'),('848','America/New_York'),('856','America/New_York'),('862','America/New_York'),
('908','America/New_York'),('973','America/New_York'),
-- New York
('212','America/New_York'),('315','America/New_York'),('332','America/New_York'),('347','America/New_York'),
('363','America/New_York'),('516','America/New_York'),('518','America/New_York'),('585','America/New_York'),
('607','America/New_York'),('631','America/New_York'),('646','America/New_York'),('680','America/New_York'),
('716','America/New_York'),('718','America/New_York'),('838','America/New_York'),('845','America/New_York'),
('914','America/New_York'),('917','America/New_York'),('929','America/New_York'),('934','America/New_York'),
-- North Carolina
('252','America/New_York'),('336','America/New_York'),('472','America/New_York'),('704','America/New_York'),
('743','America/New_York'),('828','America/New_York'),('910','America/New_York'),('919','America/New_York'),
('980','America/New_York'),('984','America/New_York'),
-- Ohio
('216','America/New_York'),('220','America/New_York'),('234','America/New_York'),('283','America/New_York'),
('326','America/New_York'),('330','America/New_York'),('380','America/New_York'),('419','America/New_York'),
('440','America/New_York'),('513','America/New_York'),('567','America/New_York'),('614','America/New_York'),
('740','America/New_York'),('937','America/New_York'),
-- Pennsylvania
('215','America/New_York'),('223','America/New_York'),('267','America/New_York'),('272','America/New_York'),
('412','America/New_York'),('445','America/New_York'),('484','America/New_York'),('570','America/New_York'),
('582','America/New_York'),('610','America/New_York'),('717','America/New_York'),('724','America/New_York'),
('814','America/New_York'),('878','America/New_York'),
-- Rhode Island
('401','America/New_York'),
-- South Carolina
('803','America/New_York'),('839','America/New_York'),('843','America/New_York'),('854','America/New_York'),
('864','America/New_York'),
-- Tennessee (Eastern part)
('423','America/New_York'),('865','America/New_York'),
-- Vermont
('802','America/New_York'),
-- Virginia
('276','America/New_York'),('434','America/New_York'),('540','America/New_York'),('571','America/New_York'),
('703','America/New_York'),('757','America/New_York'),('804','America/New_York'),('826','America/New_York'),
('948','America/New_York'),
-- West Virginia
('304','America/New_York'),('681','America/New_York'),
-- ============ Central: America/Chicago ============
-- Alabama
('205','America/Chicago'),('251','America/Chicago'),('256','America/Chicago'),('334','America/Chicago'),
('659','America/Chicago'),('938','America/Chicago'),
-- Arkansas
('327','America/Chicago'),('479','America/Chicago'),('501','America/Chicago'),('870','America/Chicago'),
-- Florida panhandle + its overlay (majority Central; see table comment)
('850','America/Chicago'),('448','America/Chicago'),
-- Illinois
('217','America/Chicago'),('224','America/Chicago'),('309','America/Chicago'),('312','America/Chicago'),
('331','America/Chicago'),('447','America/Chicago'),('618','America/Chicago'),('630','America/Chicago'),
('708','America/Chicago'),('773','America/Chicago'),('779','America/Chicago'),('815','America/Chicago'),
('847','America/Chicago'),('872','America/Chicago'),
-- Indiana (NW corner)
('219','America/Chicago'),
-- Iowa
('319','America/Chicago'),('515','America/Chicago'),('563','America/Chicago'),('641','America/Chicago'),
('712','America/Chicago'),
-- Kansas
('316','America/Chicago'),('620','America/Chicago'),('785','America/Chicago'),('913','America/Chicago'),
-- Kentucky (western)
('270','America/Chicago'),('364','America/Chicago'),
-- Louisiana
('225','America/Chicago'),('318','America/Chicago'),('337','America/Chicago'),('504','America/Chicago'),
('985','America/Chicago'),
-- Minnesota
('218','America/Chicago'),('320','America/Chicago'),('507','America/Chicago'),('612','America/Chicago'),
('651','America/Chicago'),('763','America/Chicago'),('952','America/Chicago'),
-- Mississippi
('228','America/Chicago'),('601','America/Chicago'),('662','America/Chicago'),('769','America/Chicago'),
-- Missouri
('314','America/Chicago'),('417','America/Chicago'),('573','America/Chicago'),('636','America/Chicago'),
('660','America/Chicago'),('816','America/Chicago'),
-- Nebraska
('308','America/Chicago'),('402','America/Chicago'),('531','America/Chicago'),
-- North Dakota
('701','America/Chicago'),
-- Oklahoma
('405','America/Chicago'),('539','America/Chicago'),('572','America/Chicago'),('580','America/Chicago'),
('918','America/Chicago'),
-- South Dakota
('605','America/Chicago'),
-- Tennessee (central/west)
('615','America/Chicago'),('629','America/Chicago'),('731','America/Chicago'),('901','America/Chicago'),
('931','America/Chicago'),
-- Texas (all Central except 915 El Paso -> Mountain below)
('210','America/Chicago'),('214','America/Chicago'),('254','America/Chicago'),('281','America/Chicago'),
('325','America/Chicago'),('346','America/Chicago'),('361','America/Chicago'),('409','America/Chicago'),
('430','America/Chicago'),('432','America/Chicago'),('469','America/Chicago'),('512','America/Chicago'),
('682','America/Chicago'),('713','America/Chicago'),('726','America/Chicago'),('737','America/Chicago'),
('806','America/Chicago'),('817','America/Chicago'),('830','America/Chicago'),('832','America/Chicago'),
('903','America/Chicago'),('936','America/Chicago'),('940','America/Chicago'),('945','America/Chicago'),
('956','America/Chicago'),('972','America/Chicago'),('979','America/Chicago'),
-- Wisconsin
('262','America/Chicago'),('274','America/Chicago'),('414','America/Chicago'),('534','America/Chicago'),
('608','America/Chicago'),('715','America/Chicago'),('920','America/Chicago'),
-- ============ Mountain: America/Denver ============
-- Colorado
('303','America/Denver'),('719','America/Denver'),('720','America/Denver'),('970','America/Denver'),
('983','America/Denver'),
-- Idaho
('208','America/Denver'),('986','America/Denver'),
-- Montana
('406','America/Denver'),
-- New Mexico
('505','America/Denver'),('575','America/Denver'),
-- Texas (El Paso)
('915','America/Denver'),
-- Utah
('385','America/Denver'),('435','America/Denver'),('801','America/Denver'),
-- Wyoming
('307','America/Denver'),
-- ============ Arizona (no DST): America/Phoenix ============
('480','America/Phoenix'),('520','America/Phoenix'),('602','America/Phoenix'),('623','America/Phoenix'),
('928','America/Phoenix'),
-- ============ Pacific: America/Los_Angeles ============
-- California
('209','America/Los_Angeles'),('213','America/Los_Angeles'),('279','America/Los_Angeles'),('310','America/Los_Angeles'),
('323','America/Los_Angeles'),('341','America/Los_Angeles'),('350','America/Los_Angeles'),('369','America/Los_Angeles'),
('408','America/Los_Angeles'),('415','America/Los_Angeles'),('424','America/Los_Angeles'),('442','America/Los_Angeles'),
('510','America/Los_Angeles'),('530','America/Los_Angeles'),('559','America/Los_Angeles'),('562','America/Los_Angeles'),
('619','America/Los_Angeles'),('626','America/Los_Angeles'),('628','America/Los_Angeles'),('650','America/Los_Angeles'),
('657','America/Los_Angeles'),('661','America/Los_Angeles'),('669','America/Los_Angeles'),('707','America/Los_Angeles'),
('714','America/Los_Angeles'),('747','America/Los_Angeles'),('760','America/Los_Angeles'),('805','America/Los_Angeles'),
('818','America/Los_Angeles'),('820','America/Los_Angeles'),('831','America/Los_Angeles'),('840','America/Los_Angeles'),
('858','America/Los_Angeles'),('909','America/Los_Angeles'),('916','America/Los_Angeles'),('925','America/Los_Angeles'),
('949','America/Los_Angeles'),('951','America/Los_Angeles'),
-- Nevada
('702','America/Los_Angeles'),('725','America/Los_Angeles'),('775','America/Los_Angeles'),
-- Oregon
('458','America/Los_Angeles'),('503','America/Los_Angeles'),('541','America/Los_Angeles'),('971','America/Los_Angeles'),
-- Washington
('206','America/Los_Angeles'),('253','America/Los_Angeles'),('360','America/Los_Angeles'),('425','America/Los_Angeles'),
('509','America/Los_Angeles'),('564','America/Los_Angeles'),
-- ============ Alaska / Hawaii ============
('907','America/Anchorage'),
('808','Pacific/Honolulu'),
-- ============ US territories ============
('787','America/Puerto_Rico'),('939','America/Puerto_Rico'),
('340','America/St_Thomas'),
('671','Pacific/Guam'),('670','Pacific/Saipan'),('684','Pacific/Pago_Pago'),
-- ============ Canada ============
-- Newfoundland
('709','America/St_Johns'),
-- Maritimes
('902','America/Halifax'),('782','America/Halifax'),
('506','America/Moncton'),('428','America/Moncton'),
-- Ontario
('226','America/Toronto'),('249','America/Toronto'),('289','America/Toronto'),('343','America/Toronto'),
('365','America/Toronto'),('382','America/Toronto'),('416','America/Toronto'),('437','America/Toronto'),
('519','America/Toronto'),('548','America/Toronto'),('613','America/Toronto'),('647','America/Toronto'),
('683','America/Toronto'),('705','America/Toronto'),('742','America/Toronto'),('753','America/Toronto'),
('807','America/Toronto'),('905','America/Toronto'),('942','America/Toronto'),
-- Quebec
('263','America/Toronto'),('354','America/Toronto'),('367','America/Toronto'),('418','America/Toronto'),
('438','America/Toronto'),('450','America/Toronto'),('468','America/Toronto'),('514','America/Toronto'),
('579','America/Toronto'),('581','America/Toronto'),('819','America/Toronto'),('873','America/Toronto'),
-- Manitoba
('204','America/Winnipeg'),('431','America/Winnipeg'),('584','America/Winnipeg'),
-- Saskatchewan (no DST)
('306','America/Regina'),('639','America/Regina'),('474','America/Regina'),
-- Alberta
('403','America/Edmonton'),('587','America/Edmonton'),('780','America/Edmonton'),('825','America/Edmonton'),
('368','America/Edmonton'),
-- British Columbia
('236','America/Vancouver'),('250','America/Vancouver'),('604','America/Vancouver'),('672','America/Vancouver'),
('778','America/Vancouver'),
-- Territories (Yukon/NWT/Nunavut share 867; Mountain is the safe middle)
('867','America/Edmonton')
on conflict (area_code) do nothing;

--------------------------------------------------------------------------------
-- updated_at triggers (existing set_updated_at() pattern)
--------------------------------------------------------------------------------

create trigger outreach_texts_updated_at before update on outreach_texts
  for each row execute function set_updated_at();
create trigger text_campaigns_updated_at before update on text_campaigns
  for each row execute function set_updated_at();
create trigger text_sends_updated_at before update on text_sends
  for each row execute function set_updated_at();
create trigger texting_settings_updated_at before update on texting_settings
  for each row execute function set_updated_at();

--------------------------------------------------------------------------------
-- Helper functions
--------------------------------------------------------------------------------

create or replace function phone_is_suppressed(p_phone text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from phone_suppressions s
    where normalize_phone(s.phone) = normalize_phone(p_phone)
      and (s.expires_at is null or s.expires_at > now())
  );
$$;

create or replace function phone_e164(p text) returns text
language sql immutable security definer
set search_path = public, pg_temp
as $$
  select '+1' || normalize_phone(p);  -- NANP assumed; null in -> null out
$$;

-- Recipient-local quiet hours. Unknown area code: assume Eastern but floor the
-- start at 11:00 ET (covers a Pacific cell with an odd code: 11:00 ET = 08:00 PT).
create or replace function texting_quiet_ok(p_phone text) returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  s texting_settings;
  v_tz text;
  v_local time;
begin
  select * into s from texting_settings where id = 1;
  if not found then
    return false;
  end if;

  select tz into v_tz
  from area_code_timezones
  where area_code = left(normalize_phone(p_phone), 3);

  if v_tz is null then
    v_local := (now() at time zone 'America/New_York')::time;
    return v_local >= greatest(s.quiet_start, time '11:00')
       and v_local <  s.quiet_cutoff;
  end if;

  v_local := (now() at time zone v_tz)::time;
  return v_local >= s.quiet_start and v_local < s.quiet_cutoff;
end;
$$;

-- FTSA combined calls+texts touch counter for the trailing 24h.
create or replace function recent_touches(p_phone text) returns int
language sql stable security definer
set search_path = public, pg_temp
as $$
  select (case when exists (
            select 1 from outreach_calls c
            where normalize_phone(c.phone) = normalize_phone(p_phone)
              and c.last_call_at > now() - interval '24 hours'
          ) then 1 else 0 end)
       + (select count(*)::int from text_messages m
          where m.direction = 'outbound'
            and normalize_phone(m.phone) = normalize_phone(p_phone)
            and m.created_at > now() - interval '24 hours');
$$;

--------------------------------------------------------------------------------
-- The gate: every rule, one function, per-gate results recorded
--------------------------------------------------------------------------------

create or replace function texting_send_allowed(p_phone text, p_is_reply boolean)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := normalize_phone(p_phone);
  s texting_settings;
  scrub phone_scrubs;
  v_suppressed boolean;
  v_scrub_fresh boolean;
  v_rnd_ok boolean;
  v_quiet boolean;
  v_touches int;
  v_reply_24h boolean;
  v_touch_ok boolean;
  v_cap int;
  v_sent_today int;
  v_daily_ok boolean;
  v_one_ok boolean;
  v_paused_ok boolean;
  v_checks jsonb;
  v_allowed boolean;
begin
  select * into s from texting_settings where id = 1;

  v_suppressed := phone_is_suppressed(p_phone);

  select * into scrub from phone_scrubs where normalize_phone(phone) = v_phone;
  v_scrub_fresh := found and scrub.scrubbed_at > now() - interval '30 days';
  v_rnd_ok := v_scrub_fresh and coalesce(scrub.rnd_ok, false);

  v_quiet := texting_quiet_ok(p_phone);

  -- Touch cap: replies to an inbound received within 24h are exempt from
  -- touch_cap, and from nothing else on this gate.
  v_touches := recent_touches(p_phone);
  v_reply_24h := p_is_reply and exists (
    select 1 from outreach_texts t
    where normalize_phone(t.phone) = v_phone
      and t.last_inbound_at > now() - interval '24 hours');
  v_touch_ok := v_reply_24h or v_touches < 3;

  -- Ramp: effective daily cap = least(per_line_daily_cap, 20 + 10*days-since-ramp-start).
  v_cap := case when s.id is null or s.ramp_started_on is null then 0
                else least(s.per_line_daily_cap,
                           20 + 10 * (current_date - s.ramp_started_on)) end;
  select count(*)::int into v_sent_today
  from text_messages
  where direction = 'outbound' and created_at >= date_trunc('day', now());
  v_daily_ok := p_is_reply or v_sent_today < v_cap;

  v_one_ok := p_is_reply or not exists (
    select 1 from text_messages m
    where m.direction = 'outbound'
      and normalize_phone(m.phone) = v_phone
      and m.created_at > now() - interval '24 hours');

  v_paused_ok := s.id is not null and not s.paused and s.ramp_started_on is not null;

  v_checks := jsonb_build_object(
    'suppressed',     jsonb_build_object('ok', not v_suppressed),
    'scrub_fresh',    jsonb_build_object('ok', v_scrub_fresh),
    'rnd_ok',         jsonb_build_object('ok', v_rnd_ok),
    'quiet',          jsonb_build_object('ok', v_quiet),
    'touch_cap',      jsonb_build_object('ok', v_touch_ok,
                                         'touches', v_touches,
                                         'reply_exempt', v_reply_24h),
    'daily_line_cap', jsonb_build_object('ok', v_daily_ok,
                                         'sent_today', v_sent_today,
                                         'effective_cap', v_cap,
                                         'reply_exempt', p_is_reply),
    'one_per_day',    jsonb_build_object('ok', v_one_ok,
                                         'reply_exempt', p_is_reply),
    'paused',         jsonb_build_object('ok', v_paused_ok)
  );

  v_allowed := (not v_suppressed) and v_scrub_fresh and v_rnd_ok and v_quiet
               and v_touch_ok and v_daily_ok and v_one_ok and v_paused_ok;

  return jsonb_build_object('allowed', v_allowed,
                            'is_reply', p_is_reply,
                            'phone', v_phone,
                            'checked_at', now(),
                            'checks', v_checks);
end;
$$;

--------------------------------------------------------------------------------
-- Triggers on text_messages: the backstop n8n cannot be talked past
--------------------------------------------------------------------------------

-- BEFORE INSERT, outbound only. record_text_send_result() sets a transaction-local
-- GUC to bypass (the send already happened -- the transcript must record reality).
create or replace function text_messages_outbound_gate() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign uuid := new.campaign_id;
  v_is_reply boolean;
  v_res jsonb;
  v_failed text;
begin
  if coalesce(current_setting('crm.texting_gate_bypass', true), '') = 'on' then
    return new;
  end if;

  if v_campaign is null and new.send_id is not null then
    select campaign_id into v_campaign from text_sends where id = new.send_id;
  end if;

  -- is_reply inferred: no campaign AND an inbound on this thread within 7 days.
  v_is_reply := v_campaign is null and exists (
    select 1 from outreach_texts t
    where normalize_phone(t.phone) = normalize_phone(new.phone)
      and t.last_inbound_at > now() - interval '7 days');

  v_res := texting_send_allowed(new.phone, v_is_reply);

  if not coalesce((v_res->>'allowed')::boolean, false) then
    select string_agg(k, ', ' order by k) into v_failed
    from jsonb_each(v_res->'checks') as e(k, v)
    where (v->>'ok')::boolean is distinct from true;
    raise exception 'texting gate blocked outbound to %: failed gates: %',
      new.phone, coalesce(v_failed, 'unknown');
  end if;

  return new;
end;
$$;

create trigger text_messages_outbound_gate
  before insert on text_messages
  for each row
  when (new.direction = 'outbound')
  execute function text_messages_outbound_gate();

-- AFTER INSERT, inbound only. STOP detection FIRST (deterministic regex), then
-- thread upsert into the VA queue.
create or replace function text_messages_inbound_intake() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := normalize_phone(new.phone);
  v_stop boolean := coalesce(new.body, '')
    ~* '\m(stop|stopall|quit|end|cancel|unsubscribe|revoke)\M';
  v_target uuid;
begin
  if v_stop then
    insert into phone_suppressions (phone, reason, source, evidence)
    values (new.phone, 'opt_out', 'inbound_stop',
            jsonb_build_object('message_id', new.id,
                               'blooio_message_id', new.blooio_message_id))
    on conflict do nothing;
  end if;

  update outreach_texts
     set last_inbound_at = now(),
         queue_state = case when v_stop then 'done' else 'awaiting_va' end
   where normalize_phone(phone) = v_phone;

  if not found then
    -- No thread yet: hang one on the spine target that holds this phone.
    select target_id into v_target
    from outreach_calls
    where normalize_phone(phone) = v_phone
    order by last_call_at desc nulls last
    limit 1;
    if v_target is not null then
      insert into outreach_texts (target_id, phone, last_inbound_at, queue_state)
      values (v_target, new.phone, now(),
              case when v_stop then 'done' else 'awaiting_va' end)
      on conflict ((normalize_phone(phone))) do update
        set last_inbound_at = excluded.last_inbound_at,
            queue_state = excluded.queue_state;
    end if;
  end if;

  return new;
end;
$$;

create trigger text_messages_inbound_intake
  after insert on text_messages
  for each row
  when (new.direction = 'inbound')
  execute function text_messages_inbound_intake();

-- A new suppression instantly blocks everything still waiting in the queue.
create or replace function phone_suppressions_block_pending() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update text_sends
     set status = 'blocked',
         blocked_reason = new.reason::text
   where status in ('draft','approved','queued')
     and normalize_phone(phone) = normalize_phone(new.phone);
  return new;
end;
$$;

create trigger phone_suppressions_block_pending
  after insert on phone_suppressions
  for each row execute function phone_suppressions_block_pending();

--------------------------------------------------------------------------------
-- Queue worker RPCs
--------------------------------------------------------------------------------

-- Claim approved sends for the worker. Every claim writes an immutable
-- send_authorizations row; rows failing gates go to 'blocked', never silently skipped.
create or replace function claim_text_sends(p_limit int default 10)
returns setof jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  r text_sends;
  v_is_reply boolean;
  v_res jsonb;
  v_failed text;
  scrub phone_scrubs;
begin
  for r in
    select * from text_sends
    where status = 'approved'
    order by created_at asc
    limit p_limit
    for update skip locked
  loop
    v_is_reply := r.campaign_id is null and exists (
      select 1 from outreach_texts t
      where normalize_phone(t.phone) = normalize_phone(r.phone)
        and t.last_inbound_at > now() - interval '7 days');

    v_res := texting_send_allowed(r.phone, v_is_reply);

    if coalesce((v_res->>'allowed')::boolean, false) then
      update text_sends
         set status = 'sending', claimed_at = now()
       where id = r.id;

      select * into scrub
      from phone_scrubs
      where normalize_phone(phone) = normalize_phone(r.phone);

      insert into send_authorizations
        (send_id, phone, scrubbed_at, scrub_vendor, checks, template_hash, approved_by)
      values
        (r.id, r.phone, scrub.scrubbed_at, scrub.vendor, v_res, md5(r.body), r.approved_by);

      return next jsonb_build_object(
        'send_id', r.id,
        'phone_e164', phone_e164(r.phone),
        'body', r.body,
        'idempotency_key', r.id);
    else
      select string_agg(k, ', ' order by k) into v_failed
      from jsonb_each(v_res->'checks') as e(k, v)
      where (v->>'ok')::boolean is distinct from true;

      update text_sends
         set status = 'blocked',
             blocked_reason = coalesce(v_failed, 'gate')
       where id = r.id;
    end if;
  end loop;
end;
$$;

-- Worker reports the Blooio result. The outbound transcript row is inserted with
-- the gate bypassed via a transaction-local GUC: the send already happened, the
-- transcript must record reality.
create or replace function record_text_send_result(p jsonb) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := (p->>'send_id')::uuid;
  v_ok boolean := coalesce((p->>'ok')::boolean, false);
  -- Never let an odd protocol string error the RPC after the send already happened.
  v_proto msg_protocol := case lower(coalesce(p->>'protocol', ''))
                            when 'imessage' then 'imessage'
                            when 'sms' then 'sms'
                            when 'rcs' then 'rcs'
                            else 'unknown'
                          end::msg_protocol;
  s text_sends;
begin
  select * into s from text_sends where id = v_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'send not found', 'send_id', v_id);
  end if;

  if v_ok then
    update text_sends
       set status = 'sent',
           sent_at = now(),
           blooio_message_id = nullif(p->>'blooio_message_id', ''),
           error = null
     where id = v_id;

    perform set_config('crm.texting_gate_bypass', 'on', true);
    insert into text_messages
      (phone, direction, body, protocol, status, blooio_message_id,
       campaign_id, send_id, sent_at)
    values
      (s.phone, 'outbound', s.body, v_proto, 'sent',
       nullif(p->>'blooio_message_id', ''), s.campaign_id, s.id, now())
    on conflict (blooio_message_id) do nothing;
    perform set_config('crm.texting_gate_bypass', '', true);

    if s.target_id is not null then
      insert into outreach_texts (target_id, phone, protocol, last_outbound_at)
      values (s.target_id, s.phone, v_proto, now())
      on conflict ((normalize_phone(phone))) do update
        set last_outbound_at = excluded.last_outbound_at,
            protocol = case when excluded.protocol <> 'unknown'
                            then excluded.protocol else outreach_texts.protocol end;
    else
      update outreach_texts
         set last_outbound_at = now(),
             protocol = case when v_proto <> 'unknown' then v_proto else protocol end
       where normalize_phone(phone) = normalize_phone(s.phone);
    end if;

    return jsonb_build_object('ok', true, 'send_id', v_id, 'recorded', 'sent');
  else
    update text_sends
       set status = 'failed', error = p->>'error'
     where id = v_id;
    return jsonb_build_object('ok', true, 'send_id', v_id, 'recorded', 'failed');
  end if;
end;
$$;

--------------------------------------------------------------------------------
-- Blooio webhook ingest
--------------------------------------------------------------------------------

create or replace function ingest_blooio_event(p jsonb) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_type text := p->>'type';
  d jsonb := coalesce(p->'data', '{}'::jsonb);
  v_mid text;
  v_phone text;
  v_proto msg_protocol;
  v_n int := 0;
  v_m int := 0;
begin
  v_mid := coalesce(nullif(d->>'message_id',''), nullif(d#>>'{message,id}',''),
                    nullif(d->>'id',''));
  v_phone := coalesce(nullif(d->>'phone',''), nullif(d->>'from',''),
                      nullif(d#>>'{message,from}',''), nullif(d->>'participant',''),
                      nullif(d->>'chat_id',''));
  v_proto := case lower(coalesce(nullif(d->>'protocol',''), nullif(d->>'service',''), ''))
               when 'imessage' then 'imessage'
               when 'sms' then 'sms'
               when 'rcs' then 'rcs'
               else 'unknown'
             end::msg_protocol;

  if v_type = 'message.received' then
    if normalize_phone(v_phone) is null then
      return jsonb_build_object('ok', false, 'type', v_type,
                                'reason', 'no usable phone in envelope');
    end if;
    insert into text_messages (phone, direction, body, protocol, status,
                               blooio_message_id, raw)
    values (v_phone, 'inbound',
            coalesce(d#>>'{message,text}', d->>'text', d->>'body'),
            v_proto, 'received', v_mid, p)
    on conflict (blooio_message_id) do nothing;
    get diagnostics v_n = row_count;
    return jsonb_build_object('ok', true, 'type', v_type, 'inserted', v_n);

  elsif v_type in ('message.sent','message.delivered','message.failed','message.read') then
    if v_mid is null then
      return jsonb_build_object('ok', false, 'type', v_type, 'reason', 'no message id');
    end if;
    update text_messages
       set status = case v_type
                      when 'message.sent' then 'sent'
                      when 'message.delivered' then 'delivered'
                      when 'message.failed' then 'failed'
                      else status
                    end,
           delivered_at = case when v_type = 'message.delivered' then now() else delivered_at end,
           read_at = case when v_type = 'message.read' then now() else read_at end,
           error = case when v_type = 'message.failed'
                        then coalesce(d->>'error', d->>'reason', 'failed')
                        else error end
     where blooio_message_id = v_mid;
    get diagnostics v_n = row_count;

    if v_type in ('message.delivered','message.failed') then
      update text_sends
         set status = case v_type
                        when 'message.delivered' then 'delivered'::text_send_status
                        else 'failed'::text_send_status
                      end,
             error = case when v_type = 'message.failed'
                          then coalesce(d->>'error', d->>'reason', 'failed')
                          else error end
       where blooio_message_id = v_mid;
      get diagnostics v_m = row_count;
    end if;
    return jsonb_build_object('ok', true, 'type', v_type,
                              'messages_updated', v_n, 'sends_updated', v_m);

  elsif (v_type = 'safety.state_changed'
         and coalesce(d->>'action','') in ('pause_new','reply_only','review'))
        or v_type = 'safety.number_banned' then
    update texting_settings set paused = true where id = 1;
    return jsonb_build_object('ok', true, 'type', v_type, 'paused', true);

  else
    return jsonb_build_object('ok', true, 'type', coalesce(v_type, 'null'), 'ignored', true);
  end if;
end;
$$;

--------------------------------------------------------------------------------
-- DNC scrub worker RPCs
--------------------------------------------------------------------------------

create or replace function scrub_candidates(p_limit int default 500)
returns setof jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  return query
  select jsonb_build_object('phone_e164', phone_e164(c.ph))
  from (
    select distinct normalize_phone(u.phone) as ph
    from (
      select phone from text_sends where status in ('draft','approved')
      union all
      select phone from outreach_calls where coalesce(dnc, false) = false
    ) u
    where normalize_phone(u.phone) is not null
  ) c
  where not phone_is_suppressed(c.ph)
    and not exists (
      select 1 from phone_scrubs sc
      where normalize_phone(sc.phone) = c.ph
        and sc.scrubbed_at > now() - interval '30 days')
  limit p_limit;
end;
$$;

create or replace function ingest_scrub_result(p jsonb) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := p->>'phone';
  v_vendor text := coalesce(nullif(p->>'vendor',''), 'unknown');
begin
  if normalize_phone(v_phone) is null then
    return jsonb_build_object('ok', false, 'reason', 'bad phone');
  end if;

  insert into phone_scrubs
    (phone, federal_dnc, state_dnc, litigator, line_type, rnd_ok, vendor, raw, scrubbed_at)
  values
    (v_phone,
     (p->>'federal_dnc')::boolean,
     (p->>'state_dnc')::boolean,
     (p->>'litigator')::boolean,
     nullif(p->>'line_type',''),
     (p->>'rnd_ok')::boolean,
     v_vendor, p->'raw', now())
  on conflict ((normalize_phone(phone))) do update
    set federal_dnc = excluded.federal_dnc,
        state_dnc = excluded.state_dnc,
        litigator = excluded.litigator,
        line_type = excluded.line_type,
        rnd_ok = excluded.rnd_ok,
        vendor = excluded.vendor,
        raw = excluded.raw,
        scrubbed_at = now();

  if coalesce((p->>'federal_dnc')::boolean, false) then
    insert into phone_suppressions (phone, reason, source, evidence, expires_at)
    values (v_phone, 'federal_dnc', v_vendor, p->'raw', now() + interval '30 days')
    on conflict ((normalize_phone(phone)), reason) do update
      set expires_at = excluded.expires_at, suppressed_at = now(),
          evidence = excluded.evidence, source = excluded.source;
  end if;

  if coalesce((p->>'state_dnc')::boolean, false) then
    insert into phone_suppressions (phone, reason, source, evidence, expires_at)
    values (v_phone, 'state_dnc', v_vendor, p->'raw', now() + interval '30 days')
    on conflict ((normalize_phone(phone)), reason) do update
      set expires_at = excluded.expires_at, suppressed_at = now(),
          evidence = excluded.evidence, source = excluded.source;
  end if;

  if coalesce((p->>'litigator')::boolean, false) then
    insert into phone_suppressions (phone, reason, source, evidence, expires_at)
    values (v_phone, 'litigator', v_vendor, p->'raw', null)  -- permanent
    on conflict ((normalize_phone(phone)), reason) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'phone', normalize_phone(v_phone));
end;
$$;

--------------------------------------------------------------------------------
-- VA console RPCs (the ONLY writes the VA silo can make -- see part 2)
--------------------------------------------------------------------------------

-- Thread + transcript + candidate identities. One phone can be several flagged
-- identities (shared-landline guard) -- the console MUST disambiguate when >1.
create or replace function va_thread_context(p_phone text) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := normalize_phone(p_phone);
  v_thread jsonb;
  v_msgs jsonb;
  v_cands jsonb;
begin
  select to_jsonb(t) into v_thread
  from outreach_texts t
  where normalize_phone(t.phone) = v_phone;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at asc), '[]'::jsonb)
    into v_msgs
  from (
    select id, direction, body, protocol, status, sent_at, delivered_at,
           read_at, created_at
    from text_messages
    where normalize_phone(phone) = v_phone
    order by created_at desc
    limit 50
  ) m;

  select coalesce(jsonb_agg(jsonb_build_object(
           'target_id', t.id,
           'name', nullif(btrim(coalesce(t.first_name,'') || ' ' || coalesce(t.last_name,'')), ''),
           'company_name', t.company_name,
           'property_id', t.property_id,
           'property_address', pr.address)), '[]'::jsonb)
    into v_cands
  from outreach_targets t
  left join properties pr on pr.id = t.property_id
  where t.id in (
    select target_id from outreach_calls where normalize_phone(phone) = v_phone
    union
    select target_id from outreach_texts where normalize_phone(phone) = v_phone);

  return jsonb_build_object(
    'phone', v_phone,
    'thread', v_thread,
    'messages', v_msgs,
    'candidates', v_cands);
end;
$$;

-- VA free-text is ONLY allowed after the person has texted in.
create or replace function va_send_reply(p_phone text, p_body text) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  th outreach_texts;
  v_id uuid;
begin
  if p_body is null or btrim(p_body) = '' then
    raise exception 'va_send_reply: empty body';
  end if;

  select * into th from outreach_texts
  where normalize_phone(phone) = normalize_phone(p_phone);
  if not found or th.last_inbound_at is null then
    raise exception 'va_send_reply: no inbound thread for % -- VA replies are only allowed after the person has texted in', p_phone;
  end if;

  insert into text_sends (campaign_id, target_id, phone, body, status, approved_by, approved_at)
  values (null, th.target_id, th.phone, p_body, 'approved', auth.uid(), now())
  returning id into v_id;
  return v_id;
end;
$$;

-- "Yes, this is the owner." Mints/updates a contact following the
-- ghl_touch_verified_contact pattern with verified_by = 'va_text'; never
-- overwrites an existing verification. The live contacts_bridge_outreach
-- trigger does the spine bridging.
create or replace function va_confirm_owner(
  p_phone text, p_target_id uuid, p_first_name text, p_last_name text
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := normalize_phone(p_phone);
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last  text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_id uuid;
begin
  if p_target_id is null then
    raise exception 'va_confirm_owner: p_target_id is required (one phone can be several identities -- pick one)';
  end if;
  if v_phone is null then
    raise exception 'va_confirm_owner: bad phone %', p_phone;
  end if;

  perform 1 from outreach_targets t
  where t.id = p_target_id
    and (exists (select 1 from outreach_calls c
                 where c.target_id = t.id and normalize_phone(c.phone) = v_phone)
      or exists (select 1 from outreach_texts x
                 where x.target_id = t.id and normalize_phone(x.phone) = v_phone));
  if not found then
    raise exception 'va_confirm_owner: target % does not hold phone %', p_target_id, p_phone;
  end if;

  select id into v_id from contacts
  where normalize_phone(phone) = v_phone
  order by created_at asc limit 1;

  if v_id is null then
    insert into contacts (first_name, last_name, phone, source,
                          verified_at, verified_by, archived)
    values (coalesce(v_first, p_phone), v_last, p_phone, 'manual',
            now(), 'va_text', false)
    returning id into v_id;
  else
    -- Never overwrite an existing verification; verified_at is earned once.
    update contacts set
      verified_at = coalesce(verified_at, now()),
      verified_by = coalesce(verified_by, 'va_text'),
      first_name = case when (first_name is null or btrim(first_name) = ''
                              or first_name = phone) and v_first is not null
                        then v_first else first_name end,
      last_name = coalesce(last_name, v_last),
      archived = false
    where id = v_id;
  end if;

  update outreach_targets
     set contact_id = v_id
   where id = p_target_id and contact_id is null;

  update outreach_texts
     set queue_state = 'done'
   where normalize_phone(phone) = v_phone;

  return v_id;
end;
$$;

create or replace function va_wrong_person(p_phone text) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  v := outreach_mark_wrong_number(
         jsonb_build_object('phone', p_phone, 'source', 'va_text'));
  update outreach_texts
     set queue_state = 'done'
   where normalize_phone(phone) = normalize_phone(p_phone);
  return v;
end;
$$;

create or replace function va_not_interested(p_phone text) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_n int := 0;
begin
  if normalize_phone(p_phone) is null then
    raise exception 'va_not_interested: bad phone %', p_phone;
  end if;

  insert into phone_suppressions (phone, reason, source, expires_at)
  values (p_phone, 'said_no', 'va_text', now() + interval '12 months')
  on conflict ((normalize_phone(phone)), reason) do update
    set expires_at = excluded.expires_at, suppressed_at = now();

  update outreach_calls
     set disposition = 'not interested'
   where normalize_phone(phone) = normalize_phone(p_phone);
  get diagnostics v_n = row_count;

  update outreach_texts
     set queue_state = 'done'
   where normalize_phone(phone) = normalize_phone(p_phone);

  return jsonb_build_object('ok', true, 'calls_marked', v_n);
end;
$$;

--------------------------------------------------------------------------------
-- EXTEND outreach_mark_wrong_number: existing behavior re-emitted VERBATIM
-- (it is wired into live n8n R44 -- same signature, same return shape), plus a
-- wrong_person suppression so the texting channel stops too.
--------------------------------------------------------------------------------

create or replace function public.outreach_mark_wrong_number(p jsonb) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ghl   text := nullif(btrim(coalesce(p->>'ghl_contact_id','')), '');
  v_phone text := normalize_phone(p->>'phone');
  v_n int := 0;
begin
  if v_ghl is null and v_phone is null then
    return jsonb_build_object('ok', false, 'reason', 'need ghl_contact_id or phone');
  end if;

  update outreach_calls c
     set disposition = 'wrong number'
   where (v_ghl is not null and c.ghl_contact_id = v_ghl)
      or (v_phone is not null and normalize_phone(c.phone) = v_phone);
  get diagnostics v_n = row_count;

  -- NEW (texting channel): a wrong number is permanently suppressed for texts.
  if v_phone is null and v_ghl is not null then
    select normalize_phone(c.phone) into v_phone
    from outreach_calls c
    where c.ghl_contact_id = v_ghl and normalize_phone(c.phone) is not null
    limit 1;
  end if;
  if v_phone is not null then
    insert into phone_suppressions (phone, reason, source, evidence)
    values (v_phone, 'wrong_person',
            coalesce(p->>'source', 'wrong_number_mark'), p)
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'calls_marked', v_n);
end;
$$;

--------------------------------------------------------------------------------
-- contacts.verified_by vocabulary: add 'va_text'
--------------------------------------------------------------------------------

alter table contacts drop constraint contacts_verified_by_vocab;
alter table contacts add constraint contacts_verified_by_vocab
  check (verified_by is null or verified_by = any (array[
    'client','response','verified_owner','ghl_va','alex','manual','va_text']));

--------------------------------------------------------------------------------
-- RLS (existing blanket style; VA restrictions land in part 2)
--------------------------------------------------------------------------------

alter table phone_suppressions enable row level security;
alter table phone_scrubs enable row level security;
alter table outreach_texts enable row level security;
alter table text_campaigns enable row level security;
alter table text_sends enable row level security;
alter table text_messages enable row level security;
alter table send_authorizations enable row level security;
alter table texting_settings enable row level security;
alter table area_code_timezones enable row level security;

create policy phone_suppressions_auth_all on phone_suppressions
  for all to authenticated using (true) with check (true);
create policy phone_scrubs_auth_all on phone_scrubs
  for all to authenticated using (true) with check (true);
create policy outreach_texts_auth_all on outreach_texts
  for all to authenticated using (true) with check (true);
create policy text_campaigns_auth_all on text_campaigns
  for all to authenticated using (true) with check (true);
create policy text_sends_auth_all on text_sends
  for all to authenticated using (true) with check (true);
create policy text_messages_auth_all on text_messages
  for all to authenticated using (true) with check (true);
create policy texting_settings_auth_all on texting_settings
  for all to authenticated using (true) with check (true);
create policy area_code_timezones_auth_all on area_code_timezones
  for all to authenticated using (true) with check (true);

-- send_authorizations is append-only for EVERYONE: select + insert policies only
-- (no update/delete policy exists), and the privileges themselves are revoked.
create policy send_authorizations_auth_read on send_authorizations
  for select to authenticated using (true);
create policy send_authorizations_auth_insert on send_authorizations
  for insert to authenticated with check (true);
revoke update, delete on send_authorizations from authenticated, anon;

commit;
