# Apify county sweep — why some runs land and some don't (2026-08-21)

Alex: *"some fail and some aren't so something is wrong with our options."*

## What I could and could not reach

- **Reachable:** the live Supabase, and `#deals` in Slack.
- **Blocked:** `api.apify.com` and `n8n.ayxco.com` both return **403 at the proxy CONNECT**
  ("policy denial") from this session's egress policy. So I could **not** read the actor
  run logs, the run exit statuses, or the saved task inputs. Everything below about the
  *options themselves* is inference from the output; everything about the *failure pattern*
  is measured.

## Measured facts

### 1. Seven separate Apify tasks, one per county

The retry bot named six of them this morning, and `20260620000002` names the seventh:

| | task id |
|---|---|
| named in migration | `y1AIrIDEUY635m9RH` |
| failed 2026-08-21 | `VM2yVaoBnL8AfgwUO`, `4nrQonEyC44QqArK9`, `v7yVJiUl7NvpYbJh5`, `ZWXqqz5scUcEV2trT`, `Nfy1dXEGlLJzbIcfg`, `gUy4mXo9aYXP0oGI0` |

Seven independent saved input configs. Nothing keeps them in sync, and nothing in the repo
or the DB records what any of them is set to — that is the structural half of Alex's hunch.

### 2. Today: 6 of 7 failed, and the retry did not save it

- 06:26 ET — one ingest, 41 items (Manatee + Sarasota). The only county run that delivered.
- 08:30 ET — `AXIS Deal Bot` in `#deals`: *"Sweep retry: re-ran 6 failed county runs"*,
  listing the six task ids above.
- 09:10 ET — **still no second ingest.** The retry re-ran all six and none of them landed
  either. The retry workflow (`gIygaOGjXtJZJDOK`, added 2026-08-20) is not covering the gap.

### 3. This is the normal week, not a bad day

Distinct sweep ingests per day (7 county runs are scheduled daily, ~06:15–07:21 ET,
plus a standing 10:00 ET Hillsborough run):

| day | ingests that delivered | expected |
|---|---|---|
| 08-21 | 1 | 7 |
| 08-20 | 3 | 7 |
| 08-19 | 2 | 7 |
| 08-18 | 1 | 7 |
| 08-17 | 2 | 7 |
| 08-16 | 5 | 7 |
| 08-15 | 6 | 7 |

Median ≈ 2 of 7. The 08-15/08-16 pair is the exception, not the baseline.

### 4. Even the runs that "succeed" return a fraction of the book

Per-county, on-market scraped LoopNet industrial/land vs. the best single run ever observed:

| county | on-market in DB | best run seen | last swept |
|---|---|---|---|
| Hillsborough | 283 | 81 | 23 h |
| Polk | 279 | 102 | 20 h |
| Sarasota | 231 | ~96 (w/ Manatee) | 3 h |
| Pinellas | 216 | 141 | **122 h** |
| Manatee | 120 | ~96 (w/ Sarasota) | 3 h |
| Pasco | 109 | 26 | 50 h |

Same county, consecutive days, wildly different sizes — Pinellas has returned
141 / 34 / 6 / 2 / 1 on different mornings. A market doesn't move like that. That is
pagination dying partway through, and the run still being treated as a result.

### 5. No Crexi fallback in the sweep

Every sweep ingest since ~2026-07-20 is **100% `loopnet:` keyed, zero `crexi:`**. Crexi
items exist in the DB from the July backfills, so the actor can produce them — the county
tasks aren't asking for them. When LoopNet blocks, the run has nothing to fall back on.

### 6. 477 on-market listings the sweep has never once seen

`never_seen` (no `last_seen_in_sweep`) across on-market scraped industrial/land: **477**,
including whole counties nobody sweeps (Osceola 84, Charlotte 38, Orange 30, Hernando 24,
Lake 12) plus 52 Hillsborough / 102 Sarasota / 32 Pasco. `sweep_finalize_off_market`
requires `last_seen_in_sweep is not null`, so these can never be aged off-market — they
sit "on_market" permanently regardless of reality.

### 7. The guards are holding — the data is frozen, not wrong

`sweep_meta.last_run_at` = 2026-08-16 12:00 ET. Since then every finalize has hit
`seen_below_floor` (<300 stamped today; today is 41). So yesterday's fix is doing its job:
no mass off-market flips. The off-market picture is stale, not corrupted.

## The cause, from the run inputs Alex pasted

Alex supplied one failing and one succeeding run. They are **identical in every field
except `startUrls`**:

- failing: `.../search/restaurants/hillsborough-county-fl/for-sale/` — one URL
- succeeding: `industrial-properties` and `land`, each x `for-lease` and `for-sale`,
  `manatee-county-fl` — four URLs

`includeListingDetails: false`, `proxy: {RESIDENTIAL}`, `maxItems: 10000`,
`maxRequestRetries: 8` are already set correctly in **both**. That falsifies the first
three suspects I listed before seeing the inputs — details are already off, the proxy is
already residential, and there is no low result cap. The county tasks also drive LoopNet
through `startUrls` rather than the actor's `city`/`assetClasses`/`sourcesEnabled` search
mode, so "add Crexi" is not reachable from this shape either.

What is actually wrong:

1. **Wrong category.** `restaurants` is outside the sweep's scope entirely — the
   off-market diff and both new views filter to `industrial` + `land`. That run can
   never help, and it burns a retry slot when it fails.
2. **`for-sale` only.** The working pattern crawls lease *and* sale.

The DB agrees: over 21 days Hillsborough's morning county slot produced four small
ingests (18/26/34/7 items, each alongside Pasco — bleed from the neighbouring run),
while the separate 10:00 ET Hillsborough task produced nine ingests totalling 199. There
is no working morning Hillsborough county run.

Corrected `startUrls` for all seven counties, plus the full input JSON per task, are in
[`apify-county-task-inputs.md`](./apify-county-task-inputs.md).

Still open, in order:

- **Is the `restaurants` task deliberate** for some other purpose? If so it does not
  belong in the county-sweep group the retry bot scans.
- **`maxConcurrency: 20`** against LoopNet on residential proxies — identical in both
  runs, so it explains neither outcome, but worth lowering if blocks persist once the
  URLs are right.
- **Seven hand-maintained task inputs will drift again.** Building `startUrls` from the
  county name inside WF3 removes the class of bug.

## What was added here

`supabase/migrations/20260821140000_sweep_coverage_views.sql` — two read-only views, no
behaviour change:

- `v_sweep_coverage` — per county: on-market count, seen today / 2d / 7d, stale, never seen,
  hours since last sweep, and `fresh_today` (the same ≥20-stamp gate
  `sweep_finalize_off_market` uses to decide whether a county may age out).
- `v_sweep_ingests` — one row per observed ingest. **`items` is a lower bound for every run
  but the newest**: `last_seen_in_sweep` is overwritten, so a property re-seen later drops
  out of its earlier run's cohort.

## The gap these views don't close

There is still **no run log**. `last_seen_in_sweep` is a single overwritten column, so a
county that failed is indistinguishable from a county nobody scheduled, and an actor error
message never reaches the database at all. Answering "why did this county fail on this day"
requires WF3 to write one row per run — county, Apify run id, status, item count, error —
which is an n8n-side change, not built here.
