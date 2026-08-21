# n8n + Apify automation — research & design notes

Reference for the CRE CRM automation layer. The DB is the integration surface
(per CLAUDE.md "the schema is the API"): n8n reads/writes Supabase directly, and
the app reacts to the rows that appear.

## n8n fundamentals (how it works)

- **Workflow** = a directed graph of **nodes** connected by **connections**. Each
  node has `id`, `name`, `type` (e.g. `n8n-nodes-base.httpRequest`), `typeVersion`,
  `position` [x,y], and `parameters`. Connections are keyed by the **source node
  name** (not id).
- **Triggers** start a run. The ones we use:
  - `n8n-nodes-base.webhook` — HTTP endpoint the CRM app calls (e.g. "scrape this URL").
    Gives a production URL like `https://n8n.ayxco.com/webhook/<path>`.
  - `n8n-nodes-base.scheduleTrigger` — cron-like; for the daily morning sweep.
- **HTTP Request** (`n8n-nodes-base.httpRequest`) — calls the Apify REST API
  (run actor + get dataset items). No dedicated Apify node is required.
- **Supabase** (`n8n-nodes-base.supabase`) or **Postgres** node — writes scraped
  rows back into our tables. Needs a credential (service-role key or a Postgres
  connection string) configured **inside n8n** (we never ship that key to the browser).
- **Code** node (`n8n-nodes-base.code`) — JS/Python for mapping Apify output →
  our column names and for the requirement-matching logic.
- **Expressions**: `{{ $json.field }}`, `{{ $node["Name"].json.x }}` reference data
  between nodes.
- **Credentials** live in n8n's encrypted store, referenced by nodes — created in
  the n8n UI (or via API), never hardcoded in the workflow JSON.

## MCP tooling (how I build/manage workflows)

- Server: `n8n-mcp` (v2.57.3). 21 tools: discovery (`search_nodes`), config
  (`get_node`), validation (`validate_node`/`validate_workflow`), and management
  (`n8n_create_workflow`, `n8n_update_partial_workflow`, `n8n_test_workflow`,
  `n8n_executions`, ...). Always `get_node(detail:'standard')` before configuring.
- Build pattern: search node → get_node standard → configure → validate_workflow →
  n8n_create_workflow → n8n_test_workflow.

## ⚠️ Instance status (2026-06-13)

- `N8N_API_URL = https://n8n.ayxco.com`, API key configured.
- Health check FAILS: **HTTP 530** (Cloudflare "origin unreachable") — the n8n
  instance is down / not reachable. **Workflows cannot be created via MCP until
  this is back up.** Action for Alex: bring n8n.ayxco.com online and re-run health
  check. Everything below is designed and ready to push once it responds.

## Apify actor — `kazkn/commercial-real-estate-brokerage-intel`

LoopNet + Crexi scraper. Dedupes cross-platform, computes cap-rate intel, days-on-market,
extracts public broker contacts. One actor serves all three of our systems.

**Input (key fields):**
- `startUrls: string[]` — specific LoopNet/Crexi property URLs → **paste-a-link autopopulate**
- `city`, `state`, `assetClasses[]` (office/retail/industrial/multifamily/land/hotel/mixed-use/specialty),
  `priceMin`/`priceMax`, `maxResultsPerSource`, `includeListingDetails` → **requirement search**
- `sourcesEnabled: ["loopnet","crexi"]`
- `monitoringMode` — detect new listings across runs → **daily new-listing sweep**
- `transactionTrackingMode` — status changes (future: track when comps go off-market/executed)

**Output (per listing):** `source`, `source_listing_id`, `listing_url`,
`address_full` + `address{street,city,state,zip,lat,lng}`, `asset_class`, `sub_type`,
`sqft`, `units`, `year_built`, `lot_size_sqft`, `asking_price_usd`, `noi_usd`,
`cap_rate_listed/normalized/estimated`, `price_per_sqft`, `listed_at`, `days_on_market`,
`status`, `broker{name,company,phone,email,profile_url}`, `dedup_key`, `also_listed_on`,
`photo_urls`, `description`, `scraped_at`.

**Cost:** $0.05/run + $0.005/listing (+$0.003/listing for detail enrichment).

## Planned workflows

### 1. Scrape-by-URL (paste a LoopNet/Crexi link → autopopulate)
- Trigger: **Webhook** (POST `{ url, tenant_rep_id }`) called by the CRM "Add property → paste link".
- HTTP Request → Apify run-sync-get-dataset-items with `{ startUrls:[url], includeListingDetails:true }`.
- Code → map output to our `properties` columns (+ provenance `source='scrape'`, `source_url`, `listing_url`, broker, cap rate, etc.).
- Supabase → upsert property (dedupe on `source_listing_id`); if `tenant_rep_id` given, insert a `match` at stage `inquiring`.
- Respond to webhook with the created property (so the dialog can show it).

### 2. Requirement-matching search (find listings for a tenant)
- Trigger: **Webhook** (POST `{ tenant_rep_id }`) from a "Find listings" button.
- Fetch the tenant_rep's requirements (Supabase) → translate to Apify input
  (city/submarket → city/state, property_type → assetClasses, warehouse_sf → size hints, budget → price).
- Apify search → Code (score each listing vs requirements: size band, type, area, budget) → Supabase
  upsert properties + create `match` rows at `inquiring` for the matches above a score threshold.

### 3. Daily new-listing sweep + alert
- Trigger: **Schedule** (every morning).
- For each **active** tenant_rep: run Apify in `monitoringMode` for its criteria.
- New listing (unseen `source_listing_id`) that matches → upsert property, create a
  `match` at `inquiring`, and set a **new-match flag** so the app shows a red tag on the
  tenant's board card. (Email/push alert later — needs an email provider.)

## What the app provides for n8n (schema as the API)
- `properties`: provenance + listing fields (source, source_url, listing_url, asking
  rate/price, cap rate, broker, days_on_market, photos…).
- `matches.stage = 'inquiring'` — new search-sourced prospects land here (column before Touring).
- a new-match notification flag (per tenant_rep or per match) → red board tag.
- lease-comp / execution storage (rate, term, escalations, free rent, TI) so executed
  deals + scraped asking data accumulate as comps.

## Open items / needed from Alex
1. **Apify API token** (Settings → Integrations → API tokens). Stored as an n8n credential.
2. **n8n instance back online** (currently 530) + confirm the app may call its webhooks (CORS/allow).
3. **Supabase service-role key** added as an n8n credential so workflows can write back
   (service-role bypasses RLS — lives only in n8n, never the browser).
4. Alert preference beyond the in-app red tag (email? — needs an email provider later).

---

# ✅ BUILT & VERIFIED (2026-06-13)

All three workflows are live on `n8n.ayxco.com` (n8n **1.119.2**) and tested
end-to-end against the live Supabase. The Apify actor `RnGNMcV3v8AThR3aA`
(`kazkn/commercial-real-estate-brokerage-intel`) was validated for all three
input modes first (startUrls / city+assetClasses / monitoringMode) before any
n8n work.

## Shared Postgres core — `import_scraped_listings(p_props, p_tenant_rep_id, p_flagged_new)`
Migrations `20260613000009` (base) + `…0011` (asking lease comps). Each workflow
maps Apify output → our column names (in a Code node) and calls this one RPC,
which atomically:
- upserts each property on the namespaced `source_listing_id` (e.g. `crexi:834014`,
  `loopnet:40865556`) — idempotent via the partial unique index in `…0008`;
- for every scraped **lease** listing (one with an asking `$/SF/yr`), upserts an
  **asking lease comp** (`lease_comps.source='scrape'`, `asking_lease_rate_psf`),
  deduped on the same `source_listing_id` (migration `…0010` / `…0011`). Sale
  listings make no comp. Executed-deal fields stay null — they're manual-only,
  enforced by the `lease_comps_executed_is_manual` CHECK;
- if `p_tenant_rep_id` is set, creates a **deduped** match at stage `inquiring`
  (skips if a match for that tenant+property already exists), with `flagged_new`.
- returns `{ properties_upserted, matches_created, asking_comps_upserted, property_ids[], match_ids[] }`.

PostgREST endpoint: `POST /rest/v1/rpc/import_scraped_listings`.

## App wiring (automation-foundation branch)
The CRM calls the webhooks from the browser via `src/lib/n8n.ts` +
`src/hooks/use-automation.ts` (gated on `VITE_N8N_WEBHOOK_BASE`):
- **Tenant board → Add property → "Paste a link"** → `cre-scrape-url` → property
  lands as an `inquiring` match.
- **Tenant board → "Find listings"** → `cre-search-tenant` → matches land in Inquiring.
- `matches.flagged_new` shows a red **"New"** tag on cards; viewing the board clears it.
- Webhook nodes set `options.allowedOrigins='*'` so the browser (Vercel + localhost) can call them.
- **Vercel**: add `VITE_N8N_WEBHOOK_BASE=https://n8n.ayxco.com/webhook` env var for prod.

## Properties enrichment + Deal Map
- Property list/detail surface the scraped provenance (asking price/rate, cap rate,
  days on market, broker, listing link, photos) + association views (linked listings
  and matches). `usePropertyDeals` / deal-count on the list.
- `properties.lat/lng` (migration `…0013`) feed a **Leaflet Deal Map** on the Dashboard
  (`/`, `src/pages/dashboard.tsx` + `use-deals.ts`): one pin per listing/match on a
  located property, colored Active/Closed/Lost (derived from stage/status), filterable.
  The map reads existing deals — no separate table (per the chosen architecture).
- Coordinates: the n8n map nodes now pass `lat/lng` from the Apify address and the
  RPC (`…0014`) stores them; manual properties are geocoded via OpenStreetMap/Nominatim
  (`src/lib/geocode.ts`, wired into useCreateProperty/useUpdateProperty). One-time
  backfill geocoded existing rows.

## n8n credentials (encrypted in n8n, never in the browser/app)
- **Supabase service role** — type `supabaseApi`, id `ZxJ5godenAx0UYK3`. Injects
  `apikey` + `Authorization: Bearer` on HTTP Request nodes via
  `authentication: predefinedCredentialType` / `nodeCredentialType: supabaseApi`.
- **Apify Bearer** — type `httpHeaderAuth`, id `AEYAUiuyTtH4JCUX`
  (`Authorization: Bearer apify_api_…`). Used on the Apify HTTP Request nodes so
  the token isn't in the workflow JSON.

## Node-version gotcha (important for future edits)
The instance is n8n **1.119.2** — older than the n8n-MCP node DB. Activation fails
("Cannot read properties of undefined (reading 'execute')") if you use the
MCP-suggested *latest* typeVersions. Pin to instance-supported versions:
`httpRequest 4.2`, `respondToWebhook 1.1`, `webhook 2.1`, `code 2`,
`if 2`, `scheduleTrigger 1.2`. PostgREST GET with `Accept:
application/vnd.pgrst.object+json` comes back as a **stringified** `{data:"…"}`
in n8n — Code nodes must `JSON.parse` it (the workflows already do).

## Workflow 1 — Scrape by URL (paste a link)
- ID `O6zvbtDv7XpITcpE`. Webhook: `POST https://n8n.ayxco.com/webhook/cre-scrape-url`
  body `{ "url": "<loopnet|crexi listing or search URL>", "tenant_rep_id": "<uuid?>" }`.
- Flow: Webhook → Apify (`run-sync-get-dataset-items`, `startUrls`, details on) →
  Code map → RPC → Respond. Single property URLs work (tested both LoopNet & Crexi).
- Synchronous; ~15–70s. Returns `{ ok, scraped, result }`.

## Workflow 2 — Requirement search (find listings for a tenant)
- ID `ZhGuU8mu24K5bYCw`. Webhook: `POST https://n8n.ayxco.com/webhook/cre-search-tenant`
  body `{ "tenant_rep_id": "<uuid>", city?, state?, assetClasses?, transactionTypes?,
  priceMin?, priceMax?, sizeMin?, sizeMax?, maxResults? }`.
- Flow: Webhook → fetch tenant_rep → **Build Apify input** (parses `target_area`
  → city, default state FL; `property_type`→assetClasses; `warehouse_sf_min/max`→
  buildingSize) → IF location resolved → Apify search → map → RPC → Respond.
  No city resolvable ⇒ 422 `{ ok:false, error:'no_location' }` (pass city+state).
- Verified: Medley/Doral tenant → "Medley, FL" → 8 properties + 8 matches.

## Workflow 3 — Daily new-listing sweep (monitoring)
- ID `BPqXq4dcETFGTlcg`. **Two triggers**: Schedule (daily 07:00 America/New_York)
  **and** on-demand webhook `POST https://n8n.ayxco.com/webhook/cre-sweep-now`.
- Flow: trigger → fetch **active** tenant_reps → **Resolve tenants** (parse area,
  skip those with no city, one item per tenant) → Apify `monitoringMode` per
  tenant → map (`flagged_new=true`) → RPC. monitoringMode emits everything on the
  first run per criteria, then only unseen listings on later runs (the daily cron).
- Cost note: one Apify run per active located tenant per day
  (~$0.05 + $0.005/listing each). `maxResultsPerSource` capped at 5 in the sweep.

## Known limitations / follow-ups
- `tenant_reps` location is freeform `target_area`; the parser takes the first
  token + defaults state FL. Adding a structured `city`/`state` (or `search_*`)
  column would make #2/#3 fully reliable for tenants whose `target_area` isn't a
  city name.
- Scraped matches set `matches.source = null` (the `lead_source` enum has no
  `crexi`/`scrape` value); platform provenance lives on the property
  (`source='scrape'`, `source_url`, `listing_url`). Revisit if a scrape badge is wanted.
- App-side wiring still TODO (separate chunk): regen `database.types.ts`, add the
  `inquiring` column to the tenant board, the paste-link "Add property" mode, and
  the red `flagged_new` card tag.

---

## Sweep reliability (2026-08-21)

The daily sweep is six per-county LoopNet Apify tasks plus a Hillsborough *restaurants*
task. **All six county tasks are correctly configured and byte-identical apart from the
county slug** — verified against the Apify API. The failures are not ours:

The actor tries three lanes per search URL — LoopNet's mobile API (403 App Check), a
token-free `impit` scrape (Akamai `403 [hard-block]`), then paid unblockers. `scrapedo`
has 502'd for weeks; on **2026-08-18 `scrapingbee`'s API key expired** (`HTTP 401 …
Refresh the scrapingbee key`). With two of three lanes dead every run is a coin flip on
the last one: 6/6 runs succeeded daily through 08-16, then 1–3 of 6 since.

Those provider keys belong to the actor author — the input schema exposes no field for
them, so this can only be fixed by `kazkn`, who last built the actor 08-09 and doesn't
know. Evidence, the task inventory and the day-by-day timeline:
[`context/apify-sweep-failures-2026-08-21.md`](../context/apify-sweep-failures-2026-08-21.md).

Day-to-day health reads from two views added in `20260821140000_sweep_coverage_views.sql`:

```sql
select * from v_sweep_coverage order by on_market desc;   -- is each county's camera working?
select * from v_sweep_ingests order by ingested_at desc;
select * from v_sweep_actor_health order by day desc, source;  -- is kazkn back?  -- which runs delivered anything?
```

There is no Hernando task; Hernando rows are spillover from the Pasco run. Still missing:
a **run log** — `last_seen_in_sweep` is overwritten on every stamp, so a failed county
looks identical to an unscheduled one and the actor's error text never reaches the DB.

---

## Sweep rebuilt on `azzouzana/loopnet-scraper` (2026-08-21)

Everything above stands as the diagnosis. This is what replaced it.

**Actor** `axTRSfSIGjEY0rcwp` (`azzouzana/loopnet-scraper`). `startUrl` is **singular**, so
n8n passes one URL per run — 7 counties × 4 searches = **28 runs/day**, and the seven
hand-maintained Apify tasks are gone. Their six schedules are **disabled** (not deleted);
`cre-loopnet-daily-hillsborough-restaurants` is untouched because WF3b has its own webhook
and pipeline. Hernando is now a real county instead of Pasco spillover.

```json
{ "startUrl": "https://www.loopnet.com/search/industrial-properties/pinellas-county-fl/for-lease/",
  "maxItems": 700, "fetchFullDetails": false }
```

**WF3 `BPqXq4dcETFGTlcg`** — schedule 6:00 ET *or* called as a sub-workflow by the retry:
build jobs → start run (staggered 1 per 5 min) → wait 180 s → run status (`waitForFinish=60`)
→ fetch dataset → map → `import_scraped_listings` → stamp/xref/flag, and in parallel
`sweep_log_run`. **WF retry `gIygaOGjXtJZJDOK`** — 8:30 ET, reads `sweep_runs` for today,
re-runs only the URLs with no good result by calling WF3, so retry logic can't drift.

### Three things that bite

1. **`SUCCEEDED` does not mean it worked.** When LoopNet blocks, the actor returns 0 items,
   sets `statusMessage` to *"This search URL returned a 'page not found' response"*, and
   **still exits SUCCEEDED**. Measured 2026-08-21: four runs landed 700/72/80/25 items, then
   three consecutive runs on the *same URL* returned 0. So the sweep is rate-sensitive —
   hence the 5-minute stagger — and anything reading run status must check `item_count > 0`.
   WF3 records that case as `status='BLOCKED'`; the retry treats it as a failure.
2. **`streetAddress` is null on 97.9% of rows** (0/152 for-sale, 15/700 for-lease). The
   address survives only in the URL slug — `/Listing/904-Anclote-Rd-Tarpon-Springs-FL/41701436/`
   — so the mapper strips the trailing `-{City}-{ST}` and un-hyphenates the rest. That
   restores address coverage to 100%. Don't "simplify" it away.
3. **Land placards are bare.** At `fetchFullDetails: false` a land row's whole text is
   *"Land Offered at $279,000 in Clearwater, FL 33755"* — no acreage, no description. The old
   mapper kept land only when its text read industrial; applied here that keeps **0 of 80**
   real Pinellas land listings, so the land URLs are trusted by URL scope instead.
   `land_acres` is not recoverable at this detail level (636 of our 638 land rows have it
   from the old actor). `fetchFullDetails: true` was tested and did **not** help — it hit the
   same block.

### Reading the sweep

```sql
select * from v_sweep_runs_today;                        -- did every county report in today?
select * from v_sweep_coverage order by on_market desc;  -- freshness per (county, property_type)
select * from v_sweep_ingests order by ingested_at desc;
select * from v_sweep_actor_health order by day desc, source;  -- is kazkn back?
```

A county **missing** from `v_sweep_runs_today` never ran — the distinction the old
`last_seen_in_sweep` column could not make.

### Scope and cost (measured 2026-08-21)

**Hillsborough + Polk, industrial only, every 3 days** — 4 runs per sweep. Cron `0 6 */3 * *`
(month-anchored, so the gap never exceeds 3 days). The rest is commented out in WF3's
*Build sweep jobs*; the retry workflow duplicates the list, so change both.

**`maxItems` is not optional.** The actor's schema is `default 100, min 10, max 5000` — omitting
it caps at 100, it does not mean "unlimited". Measured on the same URL: 700 items with
`maxItems: 700`, **100 with the field absent**. Both workflows now send `maxItems: 5000` so it
never binds.

Two things the 3-day cadence would have broken, both failing *silently safe*:
- the **retry** runs daily and saw "no `sweep_runs` rows" as "everything failed", so it would
  have re-run all four URLs every morning and restored the daily spend. It now exits on a day
  with no rows;
- **off-market detection** would have stopped: both guards asked "seen since midnight?", so on
  the two days between sweeps nothing is fresh. The lookback is now `p_fresh_within_days`
  (default 3) — migration `20260821180000`. **Change the cadence ⇒ change this.**

Narrowing to industrial needed migration `20260821170000` first: the freshness gate was per
COUNTY, so sweeping Hillsborough industrial would have aged out its 71 unscraped land listings
(and Polk's 70). It is now per **(county, property_type)**.

| start URL | items | cost | |
|---|---|---|---|
| industrial / hillsborough / for-lease | **748** | $0.5616 | complete |
| industrial / hillsborough / for-sale | ~120 | ~$0.11 | estimate — this URL has only ever blocked |
| industrial / polk / for-lease | **362** | $0.2700 | complete |
| industrial / polk / for-sale | **47** | $0.0423 | complete |
| **per sweep** | **~1,277** | **~$1.15** | |

At every 3 days: 7.3 sweeps × $1.15 = $8.43, plus the kazkn canary ($1.45) = **~$9.88 against
the $14.23 left** — roughly $4.35 of headroom to 12 Sep. Hillsborough for-lease is 59% of the
bill; it is the only lever worth pulling if this needs cutting again. Full 7-county scope would
be $3.60–5.40 per sweep.

**kazkn stays scheduled as a canary** (~$0.011/failing run). Nothing ingests from it; WF3's
7:45 ET chain logs each run under `source='kazkn'` and Slacks if any deliver rows.
`v_sweep_runs_today` filters to `source='loopnet'`; compare actors in `v_sweep_actor_health`.
