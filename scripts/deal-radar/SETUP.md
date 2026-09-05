# Deal Radar — ingestion box setup (the always-on Mac)

This Mac runs the **Deal Radar worker**: it finds new industrial/land listings on
Facebook Marketplace and in watched Facebook groups, and writes them into the CRM
database. They show up on the Deal Radar dashboard (Prospecting → Deal Radar) on
*any* computer, because the database is in the cloud.

**What runs where — read this first:**

- **This Mac** (the always-on box) does the *finding*. Sign it into Facebook with
  the **burner account** — all scraping happens as that account.
- **Your main computer** does the *outreach*. When you click **Message seller** on
  the dashboard, it copies the message and opens the Facebook listing in *your main
  computer's* Chrome — logged into your **real, verified** account. So you reply as
  yourself. The two accounts never mix.
- To reply to a **group** post from your main account, that account must be a
  **member** of the group. Join the watched groups on your main account. (Marketplace
  needs no membership — anyone can message a seller.)

Nothing here ever sends a Facebook message automatically. Sending is always you,
by hand, on your main computer.

---

## Prerequisites

Install Homebrew, Node, and Chrome if they aren't already on this Mac:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

```bash
brew install node && brew install --cask google-chrome
```

## 1. Log the burner account into Chrome

Open Chrome, sign into Facebook with the **fake/burner** account, and leave it
signed in. This is the session the Marketplace reader replays. (The first worker
run may show a macOS Keychain prompt — click **Allow**.)

## 2. Clone the repo and build the Marketplace reader

```bash
cd ~ && git clone https://github.com/APOPDUDE/CRECRM.git
```

```bash
cd ~ && git clone https://github.com/jdcodes1/facebook-marketplace-mcp.git && cd ~/facebook-marketplace-mcp && npm install && npm run build
```

## 3. Configure the worker

Get the **service_role** key from the Supabase dashboard:
**Project Settings → API →** the `service_role` secret (NOT the anon key).
Link: https://supabase.com/dashboard/project/sxlttnxcutnrdzcldafh/settings/api

```bash
cd ~/CRECRM/scripts/deal-radar && npm install && cp .env.example .env
```

Open `.env` and set:

- `SUPABASE_SERVICE_ROLE_KEY=` → paste the service_role key.
- `FB_MCP_PATH=` → make sure the username matches this Mac, e.g.
  `/Users/<youruser>/facebook-marketplace-mcp/dist/index.js`.
- `ALERT_WEBHOOK_URL=` (optional) → the existing n8n webhook that forwards to Slack.
  It now carries two kinds of message, distinguished by `source`:
  `deal-radar` (health alerts) and `deal-radar-listings` (new in-market listings in
  Tampa, Pinellas, Pasco, Sarasota, Manatee). Leave blank for log-only.

> The `.env` file is git-ignored — never commit it, and never paste the
> service_role key into any file that gets pushed. The repo is public.

## 4. Test it end to end

```bash
cd ~/CRECRM/scripts/deal-radar && npm test && npm start
```

You want to see `connected to MCP`, then lines like
`Tampa × "warehouse": 3 new`. Open the Deal Radar page on your main computer —
the new rows are there. Press Ctrl-C to stop the manual run once it looks good.

## 5. Add group watching (optional but you want it)

The Marketplace reader can't see groups, so groups use a separate browser reader
(Playwright) on a **dedicated** Chrome profile (so it never fights your main
Chrome's profile lock):

```bash
cd ~/CRECRM/scripts/deal-radar && npm i playwright && npx playwright install chromium
```

```bash
npx playwright open --channel=chrome --user-data-dir="$HOME/.deal-radar-chrome" https://www.facebook.com/
```

Sign the **burner** account into Facebook in that window, then close it. The
watched groups are already set in `config.json`:

- FLORIDA WAREHOUSE BUY/SELL/RENT/TRADE
- Commercial Real Estate in Florida
- (one more — rename its placeholder label in `config.json` if you like)

> **First-run caveat:** Facebook's group page HTML is obfuscated and changes. The
> reader is defensive — if a group returns 0 posts, it logs it and moves on rather
> than crashing. If groups read 0 posts on the first real run, send the log line
> and the selectors get a quick tune. Marketplace is unaffected.

## 6. Schedule it (3 sessions a day, at human hours)

**Edit the paths first.** Open `com.crecrm.dealradar.plist` and change the clone
path and log path from `/Users/apop/CRE CRM/scripts/deal-radar` to *this* Mac's
path, e.g. `/Users/<youruser>/CRECRM/scripts/deal-radar`. Then:

```bash
cp ~/CRECRM/scripts/deal-radar/com.crecrm.dealradar.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.crecrm.dealradar.plist
```

Watch the log:

```bash
tail -f ~/Library/Logs/deal-radar.log
```

(You already keep this Mac awake 24/7, so the schedule fires reliably. If you ever
change that, note that a sleeping Mac skips scheduled runs.)

### How it paces itself (do not "speed this up")

On 2026-09-05 Facebook warned the burner account for *"suspected automated
behavior."* The cause was the old design: **104 Marketplace searches a day, 24/7
including 3am, on an exact 3-hour timer, in headless Chrome** — whose User-Agent
literally reads `HeadlessChrome/152.0.0.0`. The scraper now behaves like a person:

| | before | now |
|---|---|---|
| Searches/day | 104 | **15** |
| Schedule | every 3h exactly | 09:00 / 14:00 / 19:00 **+0-40 min random** |
| Hours | 24/7 (incl. 3am) | **08:00-22:00 only** |
| Browser | headless (`HeadlessChrome` UA) | **headed** (normal `Chrome` UA) |
| Scrolling | one jump to page bottom, every 1500ms | partial smooth scrolls, variable pauses, occasional scroll-back |
| Mouse | none, ever | real pointer movement each page |
| Keywords | all 13 every run | **5 per session, rotated** (all 13 covered in ~1.3 days) |
| Groups | all, back-to-back | **2 per session, rotated**, after a 4-12 min break |

It also enters through the Marketplace home page (rather than cold-loading
deep-linked search URLs), sometimes opens a listing like a real shopper, and
**aborts the whole session** if Facebook shows a verification/automation notice —
alerting you instead of pushing through it.

**Headed means a Chrome window actually opens on this Mac** during a session. That
is intentional and is the single biggest anti-detection win; leave it alone. It
requires this Mac to be logged into its desktop session.

Knobs live in `config.json` (`keywords_per_session`, `groups_per_session`,
`active_hours`, `pace_min_ms` / `pace_max_ms`). Turning the volume back up is what
got the account flagged the first time.

---

## Updating later

The worker gets improvements over time. To pull the latest onto this Mac:

```bash
cd ~/CRECRM && git pull && cd scripts/deal-radar && npm install
```

The launch agent picks up the new code on its next run — no need to reload it
unless `com.crecrm.dealradar.plist` itself changed. If it did, re-copy it (step 6).

---

## When something looks wrong

- **Every Marketplace search errors** → Facebook rotated its internal query ids.
  Fix: `cd ~/facebook-marketplace-mcp && npm run capture-queries && npm run build`.
- **A group reads 0 posts** → FB changed the group layout, or the
  `~/.deal-radar-chrome` profile got logged out. Re-log that profile (step 5).
- **"0 new" on a cycle is normal** — most cycles find nothing new. Check the
  dashboard's "Last poll … · N errors" strip before assuming it's broken.
- **Full reference:** `~/CRECRM/scripts/deal-radar/README.md`.
