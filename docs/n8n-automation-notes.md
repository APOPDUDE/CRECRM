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
