-- Email channel, part 3 of 4: the audience engine.
--
-- WHY THIS IS IN POSTGRES AND NOT IN n8n
-- Everything here is a business rule -- who may be mailed, which of a person's addresses wins,
-- what counts as the same human -- and the project rule is that business rules live in Postgres
-- so that every caller (the CRM page, an n8n run, a future script) gets the identical answer.
-- n8n keeps only transport: paging GHL, chunking Smartlead, pacing, retries.
--
-- THE PROBLEM IT SOLVES
-- Terrakotta mints ONE GHL CONTACT PER PHONE NUMBER. The tag "2810 buyers" holds 194 contact rows
-- that are 66 actual people -- the same person, same property, same email, up to five times,
-- differing only in Phone Grade (A+/B/C) and Line Type (Mobile/Landline). Handing a GHL tag
-- straight to Smartlead would mail one human five times from one campaign, which is precisely the
-- self-inflicted spam complaint this whole channel has to avoid. So the unit of a campaign is the
-- ADDRESS, never the GHL row, and the collapse happens here in SQL where it can be audited.
--
-- The addresses themselves come from the GHL custom field "Owner Email"
-- (pq7Z5bsYwNMOq8jgaPHN), NOT the standard email field -- scripts/tk-to-ghl.py writes there on
-- purpose because GHL's CSV importer collapses rows that share a standard email. The standard
-- field is populated on 16 of 734 contacts; Owner Email on 648.
--
-- SUPPRESSION IS THE PART THAT MATTERS
-- Measured on the live book: 9 of the 82 addresses in Alex's three named tags belong to people
-- tagged "not interested" -- people who already told him no ON THE PHONE. Emailing them is the
-- single highest complaint-probability message in the list, and at ~50 recipients ONE complaint
-- is 2%, which is far past Gmail's 0.3% ceiling. The GHL row's tags[] and dnd are therefore
-- suppression INPUTS, not passthrough decoration. ('wrong person' is deliberately excluded from
-- that list -- see v_stop_tags.) Note the CRM-side suppression columns cannot
-- carry this on their own: for the 269 addresses that are new to the CRM, this function is what
-- mints the contact, so a freshly minted row has do_not_call=false by construction and every
-- CRM-side predicate would be vacuous. The GHL tags are the only place that knowledge exists.
--
-- DRY RUN WRITES NOTHING. The preview is the thing Alex looks at before spending sending
-- reputation; it must not have already changed the book by the time he reads it.

begin;

create or replace function email_audience_build(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_dry          boolean := coalesce((p->>'dry_run')::boolean, true);
  v_audience     text    := nullif(btrim(coalesce(p->>'audience','')), '');
  v_campaign_id  text    := nullif(btrim(coalesce(p->>'campaign_id','')), '');
  v_recent_days  int     := coalesce((p->>'recent_days')::int, 60);
  -- Alex 2026-08-17: "use all the emails". Business domains are IN by default; the caller can
  -- still narrow to consumer-only by passing false.
  v_allow_business boolean := coalesce((p->>'allow_business_domains')::boolean, true);
  v_sendable     jsonb   := '[]'::jsonb;
  v_held         jsonb   := '[]'::jsonb;
  v_rows         int     := 0;
  v_minted       int     := 0;
  g              record;
  v_contact_id   uuid;
  v_prop_id      uuid;
  v_hold         text;
  v_dupes        int;
  v_po_id        uuid;
  v_po_email     text;
  -- merge values after the CRM-property fallback in 3e-bis
  v_property_type    text;
  v_property_address text;
  v_city             text;
  v_county           text;
  v_state            text;
  v_zip              text;
  v_building_sf      text;
  v_land_acres       text;
  v_free         constant text[] := array[
    'gmail.com','yahoo.com','aol.com','hotmail.com','outlook.com','icloud.com','msn.com',
    'comcast.net','bellsouth.net','verizon.net','att.net','me.com','live.com','tampabay.rr.com',
    'sbcglobal.net','cox.net','earthlink.net','ymail.com','mac.com','juno.com'
  ];
  -- Tags that mean "this human already said no". Deliberately NOT including 'wrong person':
  -- Alex's call 2026-08-17 -- that tag records "wrong person for the PHONE NUMBER we dialled",
  -- which says nothing about whether the email address reaches the right human. Suppressing it
  -- here would silently shrink the audience on the strength of a different channel's failure.
  -- The email channel forms its own opinion: a Smartlead 'Wrong Person' reply sets
  -- email_identity_suspect_at, and THAT is what holds them out of the next wave.
  v_stop_tags    constant text[] := array['dnc','do not call','not interested'];
begin
  if p->'rows' is null or jsonb_typeof(p->'rows') <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'rows must be a jsonb array');
  end if;
  if not v_dry and v_campaign_id is null then
    return jsonb_build_object('ok', false, 'reason', 'campaign_id is required when dry_run is false');
  end if;

  -- ON COMMIT DROP is enough under PostgREST (one transaction per request), but a caller that
  -- runs this twice inside one explicit transaction would hit "relation already exists".
  drop table if exists _src;
  drop table if exists _stop;
  drop table if exists _grp;

  -- ---------------------------------------------------------------------
  -- 1. Explode every GHL row into (address, row) pairs.
  --    Owner Email can legitimately hold several addresses separated by , ; or whitespace.
  -- ---------------------------------------------------------------------
  create temp table _src on commit drop as
  select
    r.value                                                    as raw,
    nullif(btrim(r.value->>'ghl_contact_id'), '')              as ghl_id,
    lower(btrim(regexp_replace(addr, '^[<"''\s]+|[>"''\s,;]+$', '', 'g'))) as email,
    lower(btrim(coalesce(r.value->>'first_name','')))          as first_name,
    lower(btrim(coalesce(r.value->>'last_name','')))           as last_name,
    nullif(btrim(coalesce(r.value->>'phone','')), '')          as phone,
    coalesce(
      (select array_agg(lower(btrim(t))) from jsonb_array_elements_text(
         case when jsonb_typeof(r.value->'tags')='array' then r.value->'tags' else '[]'::jsonb end) t),
      '{}'::text[])                                            as tags,
    coalesce((r.value->>'dnd')::boolean, false)                as dnd,
    nullif(btrim(coalesce(r.value->>'property_address','')), '') as property_address,
    nullif(btrim(coalesce(r.value->>'property_city','')), '')    as city,
    nullif(btrim(coalesce(r.value->>'property_county','')), '')  as county,
    nullif(btrim(coalesce(r.value->>'property_state','')), '')   as state,
    nullif(btrim(coalesce(r.value->>'property_zip','')), '')     as zip,
    nullif(btrim(coalesce(r.value->>'owner_name','')), '')       as owner_name,
    nullif(btrim(coalesce(r.value->>'company_name','')), '')     as company_name,
    nullif(btrim(coalesce(r.value->>'property_type','')), '')    as property_type,
    nullif(btrim(coalesce(r.value->>'building_sf','')), '')      as building_sf,
    nullif(btrim(coalesce(r.value->>'land_acres','')), '')       as land_acres,
    nullif(btrim(coalesce(r.value->>'parcel_id','')), '')        as parcel_id,
    -- CRM Link is a full URL ending in the CRM property uuid. Verified live: resolves 40/40.
    (regexp_match(coalesce(r.value->>'crm_link',''),
       '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'))[1] as crm_property_id,
    upper(btrim(coalesce(r.value->>'phone_grade','')))           as phone_grade,
    lower(btrim(coalesce(r.value->>'line_type','')))             as line_type
  from jsonb_array_elements(p->'rows') r,
       lateral regexp_split_to_table(
         coalesce(nullif(btrim(r.value->>'owner_email'),''), '') || ' ' ||
         coalesce(nullif(btrim(r.value->>'email'),''), ''),
         '[,;\s|]+'
       ) addr
  where addr ~ '^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$';

  select count(*) into v_rows from _src;

  -- ---------------------------------------------------------------------
  -- 2. Collapse to one row per ADDRESS.
  --    Representative precedence: best phone grade, then Mobile over Landline, then the row
  --    carrying the most property detail, then deterministic by ghl id so two runs agree.
  --    Field-level merge is first-non-null across the whole group, so a winner missing the
  --    property address inherits it from a sibling row.
  -- ---------------------------------------------------------------------
  -- Stop tags, pre-aggregated per address. This is deliberately its own statement: aggregating
  -- the tags[] column directly with array_agg() raises "cannot accumulate arrays of different
  -- dimensionality" the moment two contacts carry a different NUMBER of tags, which is almost
  -- always. Unnest first, aggregate second.
  create temp table _stop on commit drop as
  select s.email, array_agg(distinct tg) as stop_tags
  from _src s, unnest(s.tags) tg
  where tg = any (v_stop_tags)
  group by s.email;

  create temp table _grp on commit drop as
  select gg.*, coalesce(st.stop_tags, '{}'::text[]) as stop_tags
  from (
  select
    email,
    count(*)                                            as ghl_rows,
    array_agg(distinct ghl_id) filter (where ghl_id is not null) as ghl_ids,
    -- identity spread across the group: more than one of either and we do not trust the binding
    count(distinct btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))) as name_variants,
    count(distinct property_address) filter (where property_address is not null) as property_variants,
    bool_or(dnd)                                        as any_dnd,
    (array_agg(first_name      order by ord) filter (where first_name <> ''))[1]      as first_name,
    (array_agg(last_name       order by ord) filter (where last_name <> ''))[1]       as last_name,
    (array_agg(phone           order by ord) filter (where phone is not null))[1]     as phone,
    (array_agg(company_name    order by ord) filter (where company_name is not null))[1] as company_name,
    (array_agg(owner_name      order by ord) filter (where owner_name is not null))[1]   as owner_name,
    (array_agg(property_address order by ord) filter (where property_address is not null))[1] as property_address,
    (array_agg(city            order by ord) filter (where city is not null))[1]      as city,
    (array_agg(county          order by ord) filter (where county is not null))[1]    as county,
    (array_agg(state           order by ord) filter (where state is not null))[1]     as state,
    (array_agg(zip             order by ord) filter (where zip is not null))[1]       as zip,
    (array_agg(property_type   order by ord) filter (where property_type is not null))[1] as property_type,
    (array_agg(building_sf     order by ord) filter (where building_sf is not null))[1]    as building_sf,
    (array_agg(land_acres      order by ord) filter (where land_acres is not null))[1]     as land_acres,
    (array_agg(parcel_id       order by ord) filter (where parcel_id is not null))[1]      as parcel_id,
    (array_agg(crm_property_id order by ord) filter (where crm_property_id is not null))[1] as crm_property_id
  from (
    select s.*,
      row_number() over (partition by s.email order by
        case s.phone_grade when 'A+' then 0 when 'A' then 1 when 'B' then 2 when 'C' then 3 else 9 end,
        case when s.line_type = 'mobile' then 0 else 1 end,
        (case when s.property_address is not null then 1 else 0 end
         + case when s.crm_property_id is not null then 1 else 0 end
         + case when s.parcel_id is not null then 1 else 0 end
         + case when s.building_sf is not null then 1 else 0 end) desc,
        s.ghl_id
      ) as ord
    from _src s
  ) t
  group by email
  ) gg
  left join _stop st on st.email = gg.email;

  -- ---------------------------------------------------------------------
  -- 3. Decide each address, and in send mode bind it to a contact.
  -- ---------------------------------------------------------------------
  for g in select * from _grp order by email loop
    v_hold       := null;
    v_contact_id := null;
    v_prop_id    := null;

    -- 3a. They already said no, on any channel. Highest-priority hold.
    if g.stop_tags is not null and cardinality(g.stop_tags) > 0 then
      v_hold := 'said_no:' || array_to_string(g.stop_tags, ',');
    elsif g.any_dnd then
      v_hold := 'ghl_dnd';

    -- 3b. The group itself is not one coherent person/property. Do not personalise a guess.
    elsif g.name_variants > 1 then
      v_hold := 'address_shared_by_' || g.name_variants || '_people';
    elsif g.property_variants > 1 then
      v_hold := 'multi_property';
    end if;

    -- 3c. What the CRM already knows about this address.
    if v_hold is null then
      select count(*) into v_dupes from contacts where lower(btrim(email)) = g.email;
      if v_dupes > 1 then
        -- Should be impossible after 20260817000100's unique index, but a reply landing on the
        -- wrong human is the worst outcome this system can produce, so it is checked, not assumed.
        v_hold := 'ambiguous_contact';
      else
        select id into v_contact_id from contacts where lower(btrim(email)) = g.email;
      end if;
    end if;

    if v_hold is null and v_contact_id is not null then
      select
        case
          when c.archived                                          then 'contact_archived'
          when c.do_not_call                                       then 'contact_do_not_call'
          when c.email_opt_out_at is not null                      then 'opted_out'
          when c.email_bounced_at is not null                      then 'previously_bounced'
          when c.email_identity_suspect_at is not null             then 'identity_suspect'
          when c.email_status in ('invalid','spamtrap','abuse','do_not_mail')
                                                                   then 'undeliverable:' || c.email_status::text
          when c.email_status = 'catch_all'                        then 'catch_all_unscored'
          when c.email_last_campaigned_at > now() - make_interval(days => v_recent_days)
                                                                   then 'campaigned_recently'
          else null
        end
      into v_hold
      from contacts c where c.id = v_contact_id;
    end if;

    -- 3d. Business domains are held by default for a human eye. Skip-traced corporate addresses
    --     carry aggregator name-collisions -- a surname matched to a large company's domain -- and
    --     a cold pitch to the wrong executive is a reputation event, not a bounce. Consumer
    --     mailboxes carry no such risk and are two of every three addresses here anyway.
    if v_hold is null and not v_allow_business
       and split_part(g.email, '@', 2) <> all (v_free) then
      v_hold := 'business_domain_review';
    end if;

    -- 3e. Resolve the property: CRM Link uuid first (exact), parcel number only when unambiguous
    --     (104 dup (county,parcel) groups exist -- never guess), never an address string.
    if g.crm_property_id is not null then
      select id into v_prop_id from properties where id = g.crm_property_id::uuid;
    end if;
    if v_prop_id is null and g.parcel_id is not null then
      -- parcel_number is NOT unique (104 duplicate (county, parcel) groups; 343 rows hold several
      -- comma-separated parcels). Bind only when the answer is unambiguous -- never guess, because
      -- a wrong property here personalises the email with somebody else's building.
      if (select count(*) from properties where parcel_number = g.parcel_id) = 1 then
        select id into v_prop_id from properties where parcel_number = g.parcel_id;
      end if;
    end if;

    -- 3e-bis. Fill the merge fields GHL cannot supply from the CRM property we just resolved.
    -- GHL has no Property Type custom field at all, so {{property_type}} would render BLANK --
    -- and that token is in the best-measured subject line on the account ("{{property_type}} on
    -- {{street}}?", 2.3% across 1,052 sends). The CRM knows the answer, so take it from there.
    -- The CRM WINS on property facts. gross_sf / land_acres / property_type are county-sourced and
    -- trigger-locked; the GHL custom fields are stale -- "Building SF" reads 26552 and "Land Acres"
    -- 2.2 on EVERY "2810 buyers" row, across different properties in different cities. Letting GHL
    -- win (as the first version did) would quote the same wrong square footage to everyone.
    select m.property_type, m.property_address, m.city, m.county, m.state, m.zip,
           m.building_sf, m.land_acres
      into v_property_type, v_property_address, v_city, v_county, v_state, v_zip,
           v_building_sf, v_land_acres
    from email_audience_property_merge(
           v_prop_id, g.property_type, g.property_address, g.city, g.county,
           g.state, g.zip, g.building_sf, g.land_acres) m;

    if v_hold is not null then
      v_held := v_held || jsonb_build_object(
        'email', g.email, 'reason', v_hold,
        'first_name', g.first_name, 'last_name', g.last_name,
        'property_address', g.property_address, 'ghl_rows', g.ghl_rows);
      continue;
    end if;

    -- 3f. Send mode only: make sure a contact exists for this address.
    if not v_dry and v_contact_id is null then
      begin
        -- A phone match is NOT enough to hang a new address on an existing person. A shared
        -- landline is the commonest skip-trace artifact in this book: GHL row "ROBERT MARSHALL"
        -- carrying tonymars@tampabay.rr.com phone-matches CRM contact "TONY MARSHALL", who
        -- already holds tonymars40@verizon.net and is verified_by='verified_owner'. Binding
        -- there would let Robert's reply overwrite Tony's phone-proven verification.
        v_po_id := null; v_po_email := null;
        if g.phone is not null then
          select id, email into v_po_id, v_po_email
          from contacts
          where normalize_phone(phone) = normalize_phone(g.phone)
          limit 1;
        end if;

        if v_po_id is not null and v_po_email is null then
          update contacts
             set email = g.email, source = coalesce(source, 'ghl')
           where id = v_po_id
          returning id into v_contact_id;
        elsif v_po_id is not null then
          -- Different human on a shared line: mint separately and refuse to verify until a
          -- person decides. Never silently overwrite an existing address.
          insert into contacts (first_name, last_name, email, source, email_identity_suspect_at, notes)
          values (nullif(initcap(g.first_name),''), nullif(initcap(g.last_name),''), g.email, 'ghl', now(),
                  'Minted by the email channel. Phone matches contact ' || v_po_id ||
                  ', who already holds a different email -- same line, probably a different person. Link or merge by hand.')
          returning id into v_contact_id;
        else
          insert into contacts (first_name, last_name, email, phone, source)
          values (nullif(initcap(g.first_name),''), nullif(initcap(g.last_name),''), g.email, g.phone, 'ghl')
          returning id into v_contact_id;
        end if;
        v_minted := v_minted + 1;
      exception when unique_violation then
        -- One collision costs one address, never the batch, and surfaces as a reviewable line.
        v_held := v_held || jsonb_build_object('email', g.email, 'reason', 'insert_conflict');
        continue;
      end;
    end if;

    if not v_dry and v_contact_id is not null then
      update contacts
         set email_last_campaigned_at = now(),
             email_campaign_id        = v_campaign_id
       where id = v_contact_id;
    end if;

    -- 3g. The lead, carrying the canonical merge vocabulary (email_merge_fields()) plus the
    --     identity envelope that lets a reply find its way home without a fuzzy matcher.
    v_sendable := v_sendable || jsonb_build_object(
      'email', g.email,
      'first_name', nullif(initcap(g.first_name), ''),
      'last_name',  nullif(initcap(g.last_name), ''),
      'phone_number', g.phone,
      'company_name', coalesce(g.company_name, g.owner_name),
      'custom_fields', jsonb_strip_nulls(jsonb_build_object(
        'first_name',       nullif(initcap(g.first_name), ''),
        'last_name',        nullif(initcap(g.last_name), ''),
        'company_name',     g.company_name,
        'owner_name',       g.owner_name,
        'property_address', v_property_address,
        -- "street" is what the winning subject lines use: the road, not the house number.
        'street',           nullif(btrim(regexp_replace(coalesce(v_property_address,''), '^[0-9\-]+\s*', '')), ''),
        'city',             v_city,
        'county',           v_county,
        'state',            v_state,
        'zip',              v_zip,
        'property_type',    v_property_type,
        'building_sf',      v_building_sf,
        'land_acres',       v_land_acres,
        'parcel_id',        g.parcel_id,
        'crm_contact_id',   v_contact_id,
        'crm_property_id',  v_prop_id,
        'ghl_contact_id',   (g.ghl_ids)[1],
        'audience',         v_audience
      )),
      'ghl_contact_ids', to_jsonb(g.ghl_ids),
      'ghl_rows_collapsed', g.ghl_rows,
      'crm_contact_id', v_contact_id,
      'crm_property_id', v_prop_id,
      'domain_type', case when split_part(g.email,'@',2) = any (v_free) then 'consumer' else 'business' end
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'dry_run', v_dry,
    'audience', v_audience,
    'counts', jsonb_build_object(
      'ghl_rows', (select count(*) from jsonb_array_elements(p->'rows')),
      'address_rows', v_rows,
      'addresses', (select count(*) from _grp),
      'sendable', jsonb_array_length(v_sendable),
      'held', jsonb_array_length(v_held),
      'contacts_minted', v_minted
    ),
    'sendable', v_sendable,
    'held', v_held
  );
end;
$fn$;

comment on function email_audience_build is
  'Turn raw GHL contact rows into a deduplicated, suppressed, identity-resolved Smartlead '
  'audience. dry_run (the default) writes NOTHING and is what the CRM preview calls. Send mode '
  'mints/links contacts and stamps the double-send guard. The unit is the ADDRESS, not the GHL '
  'row -- Terrakotta writes one row per phone, so 194 rows can be 66 people.';

revoke all on function email_audience_build(jsonb) from public, anon;
grant execute on function email_audience_build(jsonb) to authenticated, service_role;

commit;
