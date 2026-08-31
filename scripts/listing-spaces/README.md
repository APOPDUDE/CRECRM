# Listing-spaces worker (U3)

Reads the per-suite "All Available Spaces" grid off LoopNet lease listings the Apify
sweep can only summarize (the placard feed carries the SUM of available SF, a space
count, and a rate range — never which suites). Runs on the scraper Mac next to the
Deal Radar worker. DB half: `supabase/migrations/20260830120000_listing_spaces.sql`;
design + audit: `context/deal-flags-and-unit-sf-2026-08-29.md` §U3.

What it does, four times a day (00:40, 06:40, 12:40, 18:40 local — 6h apart so the bot
wall resets between sessions). The pool is ~900 listings. Each run walks up to 40 at a
**2–4 min variable gap** and stops on two consecutive walls. The slow gap is the
wall-avoidance lever; the 40 cap is only a ceiling — stop-on-challenge means the SITE
caps us, not the number, so a lenient-wall run harvests fully (~160/day across the four)
and a wall-y one just stops early. Low rate + spread-out sessions is the gentle,
defensible way to widen coverage — never fingerprint/behavior spoofing to beat the wall:
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

## Setup (on the scraper Mac — repo lives at `~/CRECRM` there, per the Deal Radar setup)

```
cd ~/CRECRM && git pull && bash scripts/listing-spaces/setup.sh
```

That installs deps, copies `../deal-radar/.env` (same SUPABASE_URL + service_role key),
runs the offline parser test, then a live smoke test (a Chrome window opens ~30s and the
two Cattlemen suites print — no DB writes). If the suites printed:

```
bash ~/CRECRM/scripts/listing-spaces/setup.sh --schedule
```

`--schedule` rewrites the plist's paths for that machine into `~/Library/LaunchAgents/`
(the committed plist carries the main-Mac path; never load it unrewritten) and loads it.
Optional supervised full run first: `cd ~/CRECRM/scripts/listing-spaces && npm start`.

**To change the schedule** (e.g. after a `git pull` that updates the plist): re-run
`bash scripts/listing-spaces/setup.sh --schedule` — it unloads and reloads the agent, so
the new times take effect. It currently runs 3×/day (07:10, 12:40, 17:35 local).

Env knobs: `LS_LIMIT` (listings/run, default 15), `LS_GAP_MIN_SEC` / `LS_GAP_MAX_SEC`
(gap between listings, default 120–240s), `LS_PROFILE_DIR`, `LS_CHROME_BIN` (default the
standard /Applications path), `LS_CDP_PORT` (default 9223 — must be free), `LS_TEST_URL`
(smoke-test mode, no DB needed). Requires Google Chrome installed.

**Tuning the pace:** if `listing_space_runs` shows runs completing all `LS_LIMIT` pages
with `challenges = 0` for a week, the wall is tolerant — raise `LS_LIMIT` and/or shorten
the gap in `.env`. If `challenges >= 2` keeps aborting runs early, go gentler (fewer
listings, longer gap). Never respond to walls with stealth (mouse/fingerprint spoofing,
IP rotation) — the safe levers are volume and spacing only.

## Health checks

- `select * from listing_space_runs order by started_at desc limit 5;` — a run with
  `challenges >= 2` and `ok=false` means the wall is up; do nothing, tomorrow retries.
  Repeated `error_detail` rows saying "no spaces module" = LoopNet changed the LDP
  layout; re-derive selectors from a live page (they're documented in worker.mjs).
- Log: `~/Library/Logs/listing-spaces.log`.
- Never tighten the pacing to catch up. The pool cycles weekly by design.
