# Deal Radar — Facebook Marketplace ingestion worker

Finds new **industrial** and **land** listings on Facebook Marketplace across the
Tampa Bay markets and inserts them into the CRM's `deal_radar` table, where the
Deal Radar page surfaces them for **one-click, human-sent** outreach.

**Nothing here sends messages.** The MCP source is read-only; outreach is a human
pasting a pre-copied message into Messenger from the app. Known caveat (Alex's
call, 2026-07-22): automating Facebook reads violates FB's ToS — account-flag
risk is accepted; run it on the designated FB account/profile.

This runs on the **MacBook, not the cloud.** The Marketplace MCP extracts your
Facebook session cookies from the macOS Keychain and needs a logged-in Chrome —
macOS-only by design. Only the database is cloud (Supabase). If we ever want it
headless/off-Mac, see the porting note at the bottom.

## How it works

Two sources feed one table (`deal_radar`), through one parse/classify/dedupe
pipeline (`normalize.mjs`):

**1. Marketplace** — `worker.mjs` spawns
  [`jdcodes1/facebook-marketplace-mcp`](https://github.com/jdcodes1/facebook-marketplace-mcp)
  (an MCP server that replays Chrome's FB session cookies from the macOS
  Keychain) and loops **markets × keywords** through its `search_listings` tool.

**2. Groups** — the Marketplace MCP CANNOT see groups, so `group-watch.mjs` is a
  separate reader: Playwright drives a real logged-in Chrome to open each group
  in `config.json` `groups`, scroll, and scrape recent posts. Post text runs the
  same price/size parse + junk gate + industrial/land classifier. Group posts are
  keyed `group:<group_id>:<post_id>` and try to detect a specific metro from the
  post body (falling back to the group's configured market). Playwright is an
  **optional dependency** — the Marketplace path works without it; groups just
  no-op with a logged run note until you install it (below).
- Hits are normalized (`normalize.mjs`): price/sqft/acres parsed from text,
  junk filtered (shelving, jobs, containers, toys…), classified
  `industrial | land` — anything else is dropped.
- Dedupe on `external_id` (the FB listing id): upsert with ignore-duplicates,
  so only genuinely new rows land, `status='new'`.
- Pacing: ≥21s between MCP calls (the server self-limits to 3 req/min; we
  respect it independently).
- Failure policy: every search is try/caught; 3 consecutive failures aborts the
  cycle, fires one alert (webhook → Slack if `ALERT_WEBHOOK_URL` is set, always
  the log), and the next scheduled run retries. A `deal_radar_runs` row is
  written every cycle — the app reads it for "last poll / errors". The worker
  **always exits 0** so launchd never crash-loops.

## Setup (once, on the Mac)

1. **Install the MCP server** (macOS only — it reads Chrome cookies via Keychain):

   ```bash
   cd ~ && git clone https://github.com/jdcodes1/facebook-marketplace-mcp
   cd facebook-marketplace-mcp && npm install && npm run build
   ```

2. **Facebook login**: open Chrome (the profile named in `CHROME_PROFILE`,
   default `Default`) and make sure you're logged into the Facebook account you
   want to browse as. The first run may pop a Keychain access prompt — allow it.

3. **Worker env**:

   ```bash
   cd "/Users/apop/CRE CRM/scripts/deal-radar"
   npm install
   cp .env.example .env   # then fill in SUPABASE_SERVICE_ROLE_KEY (+ adjust FB_MCP_PATH)
   npm test               # parser/classifier self-check
   ```

4. **Run once by hand** to verify end to end:

   ```bash
   npm start
   ```

   Watch for `connected to MCP`, then `<market> × "<keyword>": N new` lines.

5. **(Optional) Enable group watching**:

   ```bash
   cd "/Users/apop/CRE CRM/scripts/deal-radar"
   npm i playwright && npx playwright install chromium
   ```

   Group scraping uses a **dedicated** Chrome profile (so it never fights your
   main Chrome's profile lock), at `~/.deal-radar-chrome` by default
   (`GROUP_CHROME_USER_DATA_DIR` to change). Log that profile into Facebook once:

   ```bash
   npx playwright open --channel=chrome --user-data-dir="$HOME/.deal-radar-chrome" https://www.facebook.com/
   ```

   Sign in, close the window. The session persists for future headless runs. Then
   set the three group URLs in `config.json` `groups` (rename the placeholder
   labels). **First-run caveat:** Facebook's group DOM is obfuscated and changes;
   the scraper is heuristic and returns 0 posts rather than crashing if the layout
   drifts. If a group reads 0 posts on the first real run, the selectors in
   `group-watch.mjs` (`scrapeGroup`'s `page.evaluate`) need a tune — same class of
   fragility as the Marketplace `doc_id` rotation.

6. **Schedule it** (every 45 min):

   ```bash
   cp com.crecrm.dealradar.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.crecrm.dealradar.plist
   tail -f ~/Library/Logs/deal-radar.log
   ```

## Config (`config.json`)

- `markets` — `{name, lat, lng, radius_miles}` per metro (radius converted to
  km for the MCP). Defaults: Tampa r=30, Pinellas/St. Pete–Clearwater r=20,
  Plant City r=15, Lakeland r=25, Orlando r=30, Sarasota–Bradenton r=25.
- `keywords` — search terms. Note deliberate swaps vs the obvious list:
  `"commercial lot"` not `"lot"` (board games), `"outdoor storage"` not `"IOS"`
  (iPhones), `"truck yard"` not `"yard"` (yard sales).
- `min_price` (default 5000) cuts consumer junk; `limit_per_search` (20);
  `abort_after_consecutive_failures` (3).
- `groups` — `{name, url, market}` per Facebook group to watch (Playwright path).
  `market` is the fallback label when the post body names no specific metro.
  `group_scrolls` (6) = how far down each group feed to scrape per run.

## Owner backup channel (the detail sheet's "Find owner")

Marketplace/group posts almost never carry a street address (usually just
"Tampa, FL"), and our owner-lookup pipeline needs an address or parcel we won't
have — so **there is no reliable automated owner lookup for this source.** The
detail sheet's owner phone/email fields are **manual entry**: a real call/email
backup you fill when you learn it. (If DNC/TCPA ever apply, scrub before texting.)

## When it breaks

- **`doc_id` rotation** (Marketplace) — Facebook ships a deploy and the MCP's
  captured GraphQL query ids die. Symptom: every Marketplace search errors, alert
  says so. Fix: `cd ~/facebook-marketplace-mcp && npm run capture-queries && npm run build`.
- **Group scrape reads 0 posts** — Facebook changed the group DOM. The scraper
  degrades to empty rather than crashing; tune the selectors in
  `group-watch.mjs` (`scrapeGroup`). A logged-out group profile throws a clear
  "not logged into Facebook" error — re-log the `~/.deal-radar-chrome` profile.
- **Dead FB session** — re-log into Facebook (Marketplace: your main Chrome;
  groups: the dedicated deal-radar profile).
- **Zero new rows** is normal on most cycles; "0 new" ≠ broken (check
  `deal_radar_runs.errors` before debugging — same lesson as the LoopNet sweep).

## Porting off the Mac (later, if ever)

The MCP is a thin wrapper over FB's public-page GraphQL. The same calls can be
ported into a plain Node worker with an exported cookie jar (no Keychain, no
Chrome), which would run headless anywhere — n8n host included. Default build
targets the Mac + MCP path because the cookie refresh is what actually rots,
and the logged-in Chrome keeps it fresh for free.
