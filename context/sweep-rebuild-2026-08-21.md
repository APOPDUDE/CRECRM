# Sweep rebuilt: market_listings + azzouzana (2026-08-21)

> **SUPERSEDED on the actor, 2026-08-24 — the sweep runs `memo23` again.** The schema half of
> this file (`market_listings`, `sweep_runs`, the per-(county, property_type) freshness gate)
> is all still live and correct. Only the scraper changed back, once memo23's stealth-browser
> lane was proved at county scale. See
> [`kazkn-retest-2026-08-23.md`](./kazkn-retest-2026-08-23.md) and the switch-over notes in
> `docs/n8n-automation-notes.md`.

Follows [`apify-sweep-failures-2026-08-21.md`](./apify-sweep-failures-2026-08-21.md) (why the
old actor died) and [`apify-working-alternative-2026-08-21.md`](./apify-working-alternative-2026-08-21.md)
(the replacement). This is what shipped, and the four things the earlier passes got wrong.

## What shipped

| | |
|---|---|
| `market_listings` | one row per listing, FK to `properties`, unique `(source, source_listing_id)`. Backfilled **3,541 listings for 3,541 scraped properties, 0 unbacked**. |
| `properties.loopnet_property_id` | LoopNet's **building** id, learned from the sweep. New. |
| `sweep_runs` + `sweep_log_run()` + `v_sweep_runs_today` | one row per run: county, URL, actor run id, status, item count, error. |
| `import_scraped_listings` | writes the listing row; resolves a property by building id first. |
| `sweep_stamp_seen` / `sweep_finalize_off_market` | now diff **per listing**; roll the building up only when every listing on it is off. |
| `v_sweep_coverage` / `v_sweep_ingests` | repointed to `market_listings`. |
| WF3 `BPqXq4dcETFGTlcg` | per-URL runs against `axTRSfSIGjEY0rcwp`, staggered 1 per 5 min, every 3 days. |
| WF retry `gIygaOGjXtJZJDOK` | reads `sweep_runs`, re-runs only what didn't deliver, by calling WF3. |
| 6 Apify county schedules | **re-enabled as a canary** — see *Scope* below. Restaurants schedule untouched. |

## Scope, as it actually runs (Alex, 2026-08-21)

**Hillsborough + Polk, industrial only, every 3 days — 4 runs per sweep, not 28 per day.**
The other five counties and both land searches sit commented out in WF3's *Build sweep jobs*,
ready to switch back on.

### `maxItems` is not optional — omitting it means 100, not "everything"

The instinct is to drop the cap to get the whole book. The actor's schema says otherwise:

```
maxItems: integer, default 100, minimum 10, maximum 5000
```

Measured: the same Hillsborough for-lease URL returned **700 items with `maxItems: 700`** and
**100 items with the field omitted**. Leaving it out would have *cut* coverage sevenfold. So
"everything" is `maxItems: 5000` — the schema ceiling, set high enough that it never binds.

### Two things the 3-day cadence would have broken

Both fail *silently safe*, which is why they are easy to miss — nothing errors, the sweep just
quietly stops doing its job.

1. **The retry would have restored a daily sweep.** It runs every morning at 8:30 and re-runs
   any in-scope URL with no good result. On the two days between sweeps there are no
   `sweep_runs` rows at all — which it read as "everything failed" rather than "not a sweep
   day", so it would have re-run all four URLs daily and spent exactly what the cadence cut.
   It now exits quietly when the day has no rows.
2. **Off-market detection would have stopped entirely.** Both guards asked "seen since
   midnight?", so on non-sweep days the floor sees 0 and no `(county, property_type)` pair is
   ever fresh. The finalize is scheduled Sun+Wed, which drifts against a 3-day cadence, so the
   two would rarely coincide. The lookback is now a parameter,
   `p_fresh_within_days` (default **3**, must be ≥ the sweep interval and < the 7-day
   staleness rule) — migration `20260821180000`. The cron is `0 6 */3 * *`, month-anchored, so
   the gap never exceeds 3 days and the window always covers the last sweep.

**Change the cadence ⇒ change `p_fresh_within_days` with it.**

The list is duplicated in the retry workflow's *Pick URLs that did not deliver*. **Change one,
change both** — if they drift, the retry chases URLs the daily pass never ran and reports them
failed forever.

Narrowing to industrial forced a fix first (migration `20260821170000`). The freshness gate
asked *"did this COUNTY deliver ≥20 listings today?"* and then aged out industrial **or** land.
Sweep Hillsborough industrial and the county goes fresh — then Hillsborough's **71 on-market
land listings, which nothing scrapes any more, get flipped off-market after 7 days**. Polk adds
another 70. So the gate is now keyed to the **(county, property_type)** pair actually observed:
a camera pointed at industrial can only vouch for industrial. When both types are swept the
behaviour is identical — it can only ever refuse to age something out. `v_sweep_coverage` splits
by type to mirror it.

The 300 floor still clears: the two counties hold 212 + 209 = **421 on-market industrial
listings**, and a sweep returns ~1,277 rows before filtering. If the scope ever drops to one
county, the floor will start returning `seen_below_floor` and off-market detection quietly
stops — that is the next thing to notice.

### kazkn stays alive as a canary

All six old county schedules are back on, at **~$0.011 per failing run ≈ $0.07/day** — noise
next to the live sweep. Nothing ingests from it (its rows are memo23 placards, a different shape
from azzouzana's); WF3's 7:45 ET canary chain just records each run into `sweep_runs` under
`source='kazkn'` and posts to Slack if any come back with rows.

`v_sweep_runs_today` is scoped to `source='loopnet'` so canary attempts can't make an unswept
county look like it reported in. The actor comparison lives in its own view:

```sql
select * from v_sweep_actor_health order by day desc, source;  -- is kazkn back?
```

Migrations `20260821160000..160300` (the rebuild), `170000`/`170100` (per-type gate, actor
health) and `180000` (freshness window). Guards untouched throughout;
`sweep_finalize_off_market` still returns `seen_below_floor` and nothing was flipped.

## Four corrections to the earlier passes

**1. `properties.source_key` is the LISTING id, and that's now proven.** 2,797 of 2,827
scraped properties carry a `source_key` whose number equals the id in their asking comp's
`listing_url`. The old mapper wrote `'loopnet:' + l.propertyId`, but that field held LoopNet's
*listing* id. The new actor returns `listingId` in the same id space, so the backfill lines up
1:1 and no property is duplicated. `properties.loopnet_property_id` is the genuinely new thing:
the building id we never had.

**2. The 600-row explosion isn't real.** The concern was that a for-lease SRP returns *spaces*,
so 600 Pinellas rows would triple a 216-property book. Measured: **700 rows → 676 distinct
`propertyId`**. Only 23 buildings carry more than one listing (max 3, and those extras are
subleases or a genuine second direct listing). Fan-out is ~1.04×.

The real gap is **breadth, not duplication**: the `industrial-properties` SRP returns every
property type — Office 223, Retail 141, Industrial 133, mixed-use 134, Multifamily 15, Land 18.
After the mapper's industrial/land filter, 700 rows become **192**. `market_listings` is still
right — for the 23, and for re-list history — but it was built on the correct reason.

**3. `properties.listing_status` did NOT move.** The plan said migrate it off properties.
It can't: **88,171 non-scraped rows** (the county book) carry it, twelve app call sites read it,
and property-detail lets a human set it by hand. It stays as the building-level **rollup**;
`market_listings.status` is the per-listing truth the sweep drives. `last_seen_in_sweep` has no
app references at all and became a rollup cleanly.

**4. The new actor is rate-sensitive, and it lies about it.** This is the one that matters.

Four runs landed 700 / 72 / 80 / 25 items. Seventeen minutes later, three consecutive runs —
including one on the *exact URL that had just returned 700* — came back with **0 items**,
`statusMessage: "This search URL returned a 'page not found' response"`, and status
**`SUCCEEDED`**. `fetchFullDetails: true` was tested and made no difference; it is a LoopNet
block, not an input problem.

So `azzouzana` is validated at ~4 runs per sitting, not at 28/day — which is exactly the
scope it now runs at. Consequences, all built in:
- run starts are staggered **1 per 5 min** (~15 min for the 4 in scope). Measured at 45 s
  spacing: run 1 got 700 items, the very next one came back blocked.
- WF3 records `SUCCEEDED` + 0 items as **`BLOCKED`** with the actor's message in `error`
- the retry keys off `item_count > 0`, never status alone

**The block is transient.** A probe re-ran the same URL after a 10-minute pause: SUCCEEDED in
7.6 s with 10 items and a normal status message. So this is throttling that clears, not a
lockout — which is what makes the stagger plausible. It is *not proven* at 28 runs/day; the
retry pass exists to cover the residual.

**If the sweep comes back thin, read `v_sweep_runs_today` before touching anything else.**

## Field-shape traps in the new actor

- **`streetAddress` is null on 97.9% of rows** (0/152 for-sale, 15/700 for-lease). The address
  is only in the URL slug: `/Listing/904-Anclote-Rd-Tarpon-Springs-FL/41701436/`. The mapper
  strips the trailing `-{City}-{ST}` (city/state come back as real fields) and un-hyphenates
  the rest → **100% address coverage** on all three datasets tested.
- **Land placards are bare.** A land row's entire text is *"Land Offered at $279,000 in
  Clearwater, FL 33755"*. The old mapper kept land only when its text read industrial; applied
  here that keeps **0 of 80** real Pinellas land listings, so land URLs are trusted by URL scope
  instead. **`land_acres` is not recoverable** at `fetchFullDetails: false` — 636 of our 638
  land rows have acreage from the old actor and new ones won't.
- **`squareFootage` and `capRate` are null everywhere.** SF is parsed back out of `headline` /
  `sizeAndType` ("14,800 SF Industrial Building…") — 192/192 on lease, 55/61 on sale. Cap rate
  is simply lost.
- **`propertyType` is null exactly when `propertyTypeId = 14`** (mixed-use / park). The observed
  map: 1 Hospitality, 2 Industrial, 3 Land, 5 Office, 6 Retail, 7 Flex, 10 Specialty,
  11 Multifamily, 13 Health Care, 14 mixed. For 14, `gtm_listing_space_use` ("Flex, Industrial")
  is the only signal left.
- **`price` is per-SF for lease and absolute for sale**, decided by which URL you asked — the
  row itself doesn't say. `county` is always null (we get county from parcel data anyway).

## The cost, measured (not estimated)

Every URL below was run for real on 2026-08-21. Three of the four counts are **complete** —
the cap was set above the book, so it never bound.

| start URL | items | cost | |
|---|---|---|---|
| industrial / hillsborough / for-lease | **748** | $0.5616 | complete (ran at `maxItems: 2000`) |
| industrial / hillsborough / for-sale | ~120 | ~$0.11 | *estimate* — this URL blocked; Pinellas' equivalent was 72 |
| industrial / polk / for-lease | **362** | $0.2700 | complete |
| industrial / polk / for-sale | **47** | $0.0423 | complete |
| **per sweep** | **~1,277** | **~$1.15** | |

Flat **$0.0009/result**, confirmed on every run.

At **every 3 days**: 7.3 sweeps × $1.15 = **$8.43**, plus the kazkn canary at 6 runs/day ×
$0.011 = **$1.45**. **Total ~$9.88 against the $14.23 left — about $4.35 of headroom** to the
12 Sep cycle end. It fits.

Two things that make this number trustworthy, and one that doesn't:

- The 700 seen earlier was the **cap**, not the book — the true Hillsborough for-lease count is
  748. Running at `maxItems: 5000` costs $0.04 more than the truncated version did and stops
  losing 48 listings.
- Hillsborough for-lease is **59% of the bill** on its own. If spend needs cutting further,
  that is the only lever worth pulling.
- **Hillsborough for-sale has never completed** — it blocked on both attempts. ~120 is inferred
  from Pinellas (72) scaled for a bigger market. The first real sweep will put the true number
  in `sweep_runs`; check it before trusting the projection to the penny.

For reference, the full 7-county × 4-search scope at this cadence would be roughly
$3.60–5.40 per sweep. Note the for-lease SRP spends ~73% of its results on rows the mapper
discards (Office/Retail/Multifamily) and no LoopNet URL filters those server-side — so
`maxItems` and the county list are the only real levers.

## Verified end to end, on real rows

Five real Pinellas listings pushed through `import_scraped_listings`:

- `properties_upserted: 5`, **`new_property_ids: []`** — no duplicates. The book still stands
  at **3,541 properties / 3,541 listings**.
- `loopnet_property_id` learned for all five; one listing corrected `sale` → `lease`;
  `sweep_stamp_seen` reported `listings_stamped: 5`.
- Property detail renders clean in the app (address, Scraped badge, listing link, 55,395 SF).

Two bugs the test caught that reading the code did not:

1. **`COALESCE(<deal_type>, <untyped CASE>)` raises 42804 in plpgsql.** It would have thrown on
   every row of every sweep run. Bit twice — once in the backfill, once in the RPC.
2. **A rate-less lease listing was filed as a `sale` comp with no price.** The comp took its
   `deal_type` from "did we get a rate?"; the new actor omits price on ~30% of lease rows, so
   this would have poured junk sale comps into the book the valuations read. The comp now uses
   the listing's own side.

## Not ours: the Deal Map's slow load

While checking for fallout, `/properties` hangs on *"Loading the book to filter it…"* with
repeated 500s. Cause is `v_property_market_position` timing out on a whole-book fetch. It is
**pre-existing** — it depends only on `comps`, `properties` and `v_property_current_asking`,
references neither `market_listings` nor `listing_status`, and was last touched 2026-08-16.
Same family as [[reference-owner-context-view-is-the-slow-one]]. Untouched here.

## Still open

- **Rotate the Apify token** — it was pasted into a cloud transcript. Console action, then
  `secrets.md` and n8n credential `AEYAUiuyTtH4JCUX` (the n8n public API rejects credential
  read/update on this instance, so that one is a UI edit).
- **Report the expired `scrapingbee` key to `kazkn`** on the actor's Issues page — quoting the
  log line, which names the fix. Unblocks the old actor for everyone else too.
- **Cap decision** above.
- `land_acres` for newly scraped land is a real data regression vs the old actor. Appraiser
  matching backfills acreage for parcels we can resolve; unresolved ones stay blank.
