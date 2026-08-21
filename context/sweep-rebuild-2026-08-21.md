# Sweep rebuilt: market_listings + azzouzana (2026-08-21)

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
| WF3 `BPqXq4dcETFGTlcg` | 28 per-URL runs against `axTRSfSIGjEY0rcwp`, staggered 1/45 s. |
| WF retry `gIygaOGjXtJZJDOK` | reads `sweep_runs`, re-runs only what didn't deliver, by calling WF3. |
| 6 Apify county schedules | **disabled** (reversible). Restaurants schedule untouched — WF3b is a separate pipeline. |

Migrations `20260821160000..160300`. Guards untouched; `sweep_finalize_off_market` still
returns `seen_below_floor` (41 seen vs the 300 floor) and nothing was flipped.

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

So `azzouzana` is validated at ~4 runs, not at 28/day. Consequences, all built in:
- run starts are staggered **1 per 45 s** (~21 min for 28)
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

## The cost ceiling — read before turning the schedule loose

Flat **~$0.0009/result**. A full 28-URL day ≈ 4,000–6,000 results ⇒ **$3.60–5.40/day**.

The Apify account cap is **$50/month**; the cycle (13 Aug – 12 Sep) stood at **$34.00** when
this was built. **~$16 left, ~22 days to go.** At full rate the cap is hit in 3–4 days and the
sweep goes silent — which historically gets misread as "the scraper broke again"
(see `reference-apify-spend-cap-outage`). Either raise the cap or cut scope; `maxItems` (700)
and the county/search lists are both in WF3's *Build sweep jobs* node.

Cheapest scope cut available: the for-lease SRP spends ~73% of its results on rows the mapper
throws away (Office/Retail/Multifamily). There is no LoopNet URL that filters those out
server-side, so the lever is `maxItems`, not a better URL.

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
