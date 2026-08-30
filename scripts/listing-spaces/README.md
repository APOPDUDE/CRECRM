# Listing-spaces worker (U3)

Reads the per-suite "All Available Spaces" grid off LoopNet lease listings the Apify
sweep can only summarize (the placard feed carries the SUM of available SF, a space
count, and a rate range — never which suites). Runs on the scraper Mac next to the
Deal Radar worker. DB half: `supabase/migrations/20260830120000_listing_spaces.sql`;
design + audit: `context/deal-flags-and-unit-sf-2026-08-29.md` §U3.

What it does, once a day at 07:10:
1. `listing_space_targets(40)` — the 40 least-recently-scraped on-market LoopNet lease
   listings that advertise more than one space or less than the whole building.
2. Launches the REAL installed Chrome (own process, profile `~/.listing-spaces-chrome`)
   and drives it over the DevTools port. This is load-bearing: a Playwright-LAUNCHED
   Chrome carries automation flags and LoopNet hard-denies it ("Access Denied" even on
   the homepage — measured 2026-08-30), while the same machine's normally-launched
   Chrome over CDP passed cleanly. Nothing is masked; a challenge still stops the run.
   15–35s jitter between pages; reads the grid: label, SF, rate, use, build-out,
   available, term. A visible Chrome window appears for the ~17-minute run — expected.
3. `import_listing_spaces` upserts per-suite rows; suites missing from a non-empty grid
   get `gone_at` stamped (never deleted — a let suite is market evidence). A 0-row
   extraction touches nothing.
4. Two consecutive bot-wall hits abort the run (tomorrow retries); every run — aborted
   or not — lands in `listing_space_runs`.

The scraped suites feed `v_property_available_space` (source `listing_space`) and show
on the property page, where one click copies a suite into a real `units` row.

## Setup (on the scraper Mac, after `git pull`)

```
cd "/Users/apop/CRE CRM/scripts/listing-spaces"
npm install
cp ../deal-radar/.env .env              # same SUPABASE_URL + SERVICE key (+ ALERT_WEBHOOK_URL)
npm test                                # parser fixtures (offline)
LS_TEST_URL='https://www.loopnet.com/Listing/1575-Cattlemen-Rd-Sarasota-FL/34383202/' npm start
                                        # smoke test: one page, prints suites, no DB writes
npm start                               # one supervised run — watch it do ~40 pages
cp com.crecrm.listingspaces.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.crecrm.listingspaces.plist
```

Env knobs: `LS_LIMIT` (pages/run, default 40), `LS_PROFILE_DIR`, `LS_CHROME_BIN`
(default the standard /Applications path), `LS_CDP_PORT` (default 9223 — must be free),
`LS_TEST_URL` (smoke-test mode, no DB needed). Requires Google Chrome installed.

## Health checks

- `select * from listing_space_runs order by started_at desc limit 5;` — a run with
  `challenges >= 2` and `ok=false` means the wall is up; do nothing, tomorrow retries.
  Repeated `error_detail` rows saying "no spaces module" = LoopNet changed the LDP
  layout; re-derive selectors from a live page (they're documented in worker.mjs).
- Log: `~/Library/Logs/listing-spaces.log`.
- Never tighten the pacing to catch up. The pool cycles weekly by design.
