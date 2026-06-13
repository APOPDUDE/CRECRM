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
