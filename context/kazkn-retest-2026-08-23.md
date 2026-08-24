# Re-test after the author's fix — it partly works, and my first read was wrong (2026-08-23/24)

The author replied saying an older published version plus two simultaneously-down paid
providers caused the zeros, that they reproduced our search on a fixed version, and that they
were pushing it to our scraper.

**Correction to the first pass of this file.** It concluded "still broken, the author's
explanation doesn't match the log". That was overstated. It tested the *saved Apify tasks*,
got zeros, and generalised. Alex then ran the actor directly and it worked. Both are true —
the actor is intermittent, and a handful of failures is not proof it is dead.

## What is actually true

The tasks run `memo23/apify-loopnet-search-cheerio` (actor `RuOxoBM1bnc5pQ3TJ`) — *not*
`kazkn/commercial-real-estate-brokerage-intel` as earlier notes assumed. Rebuilt
**2026-08-23 10:58 UTC → build `0.0.285`**, so the fix is genuinely published.

**The free lane works again, at least sometimes.** Alex's run `HxjsHQaPm6LEifJ5F` (01:21 UTC,
build 0.0.285) returned **26 listings**, and its log shows the token-free scraper succeeding
outright:

```
[internal] SRP .../restaurants/hillsborough-county-fl/for-sale/: impit attempt 1 (chrome) → 200 [ok]
[internal] SRP ...: impit collected 26 listing id(s) across 2 page(s) — enriching
```

That is the lane that had been returning `403 [hard-block]` on all 8 attempts since 08-17. So
the author did fix something real.

**But it is a coin flip.** Five minutes after that success, on the same URL and the same build,
run after run of mine failed with `impit attempt 1..8 → 403 [hard-block]` and then both paid
backups down. Same pattern as the original outage — the difference is that the free lane now
*sometimes* wins instead of never.

## The tally on the fixed build (0.0.285)

Every run against it so far, ours and Alex's:

| time (UTC) | what | input | result |
|---|---|---|---|
| 11:00 | Polk task | `moreResults: true` | FAILED, 0 |
| 11:12 | restaurants task | `moreResults: true` | FAILED, 0 |
| 19:02 | Hillsborough task | `moreResults: true` | FAILED, 0 |
| 19:02 | restaurants task | `moreResults: true` | FAILED, 0 |
| **01:21** | **Alex, console** | `moreResults: false` | **SUCCEEDED, 26 items, `impit → 200 [ok]`** |
| 01:26 | mine, direct | `false` | FAILED, 0 |
| 01:30 | mine, direct | `true` | FAILED, 0 |
| 01:33 | mine, direct | `false` | FAILED, 0 |
| 01:37 | mine, direct | `false` | FAILED, 0, `403 hard-block` |

**1 of 9.** The lane is demonstrably alive — one clean 200 on the first attempt — but it is not
yet reliable enough to carry a sweep. Some of that may be self-inflicted: eight of those nine
were fired within a 40-minute window, and this actor family visibly throttles under exactly that
pattern (it is why the azzouzana sweep staggers 5 minutes between runs).

## Key ordering is not the cause either — ruled out by test

The two inputs carry identical data but genuinely different JSON key order (same 548 bytes,
different md5). Worth testing properly, because the first check compared *parsed dicts*, which
discards ordering before the comparison — it could not have detected this. And at that point
every success had used one ordering and every failure the other.

Byte-exact orderings, interleaved 4 minutes apart so timing cannot confound:

| ordering | delivered |
|---|---|
| the one from the successful run | **0 of 3** |
| the one from the failing runs | **0 of 3** |

All six `403 hard-block`. Ordering is not the variable — as expected mechanically, since Apify
parses the JSON and the actor reads fields by name. **1 delivered of 18 runs on build 0.0.285.**

## `moreResults` is not the cause — ruled out by test

Our saved tasks send `moreResults: true`; Alex's manual input sent `false`. That was the only
substantive difference between the two inputs (everything else in his input is the schema
default spelled out), so it was the obvious suspect. A/B/A on the same URL, minutes apart:

| run | moreResults | result |
|---|---|---|
| Alex's (console) | false | **SUCCEEDED, 26 items** |
| A1 mine | false | FAILED, 0 |
| B mine | true | FAILED, 0 |
| A2 mine | false | FAILED, 0 |

`false` both succeeded and failed, so the flag is not the discriminator. It may still matter at
*scale* — `moreResults: true` pages far deeper, and each extra page is another chance to trip
Akamai, so a 4-URL county task with deep pagination has many more ways to fail than a 26-listing
restaurant search. That is untested; it is a hypothesis, not a finding.

## The one part of the author's explanation that still doesn't fit

They said one paid provider "hit its monthly quota, which resets on Aug 29". Every failing log
shows scrape.do priming with **1,651,834 of 3,500,000 credits left** and then returning **502**,
while scrapingbee returns **HTTP 401 (invalid/expired API key)**. Neither is a quota condition.
Both paid lanes still appear genuinely down — which is why a bad draw on the free lane still
ends in zero rather than falling back cleanly.

## THE ACTUAL FIX: a third lane, gated behind memory

Neither we nor the saved tasks were ever using the lane that works.

`freeBrowserSearch` (schema: *"Internal fallback for the search step; off by default"*) launches
a **Camoufox stealth browser**. Set it `true` at 1024 MB and it silently refuses:

```
[internal-handler] FREE browser search lane requested but DISABLED this run:
                   memory 1024MB < 2048MB needed for the stealth browser
```

**All seven saved tasks run at 1024 MB.** So this lane has never once been available to a
scheduled run — which is why the schedule never recovers even when the actor is capable.

At **2048 MB** with `freeBrowserSearch: true` it engages, and it beats Akamai by rotating
sessions rather than by paying a provider:

```
camoufox attempt 1 page 1 → 403 blocked=true  ids=0
[camoufox-pool] US: warmed a fresh session (seed 2)
camoufox attempt 2 page 1 → 200 blocked=false ids=25
camoufox collected 26 listing id(s) across 2 page(s) — enriching (token-free, no unblocker)
```

`SUCCEEDED, 26 items, $0.0137`. **"no unblocker"** is the important part: it never touches
scrapedo or scrapingbee, so it is immune to the two paid providers being down — the exact thing
blocking every other lane.

To use it: `freeBrowserSearch: true` **and** memory >= 2048 MB (the API takes `?memory=2048`;
tasks carry it in their run options). Trade-off: browser runs take minutes rather than ~30 s and
cost more per run, so a 748-item county search will be materially slower than azzouzana's.

## What the author's email actually explains

Their version fix is real — build `0.0.285` restored the free `impit` lane, which is how Alex's
01:21 console run got 26 listings on the first attempt. But `impit` is probabilistic against
Akamai; what made this actor *reliable* was the two paid fallbacks catching the misses. By the
author's own email one is quota-limited **until Aug 29**, and our logs show the other is not
healthy either:

- `scrapingbee returned HTTP 401 (invalid/expired API key)` — a dead key, **not** a quota
- `scrapedo failed ... (status=502)` while priming with **1,649,501 of 3,500,000 credits left**

So until Aug 29 at the earliest, the paid lanes cannot be relied on — and the browser lane above
is the only route that doesn't need them.

## Where this leaves the sweep

No change for now. The live sweep stays on `azzouzana/loopnet-scraper`, which delivered 3 of 4
on its first real pass. memo23/kazkn stays a canary; nothing ingests from it.

If its success rate keeps climbing it becomes worth re-wiring as a second source — but the
canary has to earn that call with data, not one good run. Watch:

```sql
select * from v_sweep_actor_health order by day desc, source;
```

## A canary bug this re-test exposed

`v_sweep_actor_health` reported **0 delivered on 2026-08-22 — but Pasco and Pinellas had
actually SUCCEEDED.** The canary read `stats.datasetItemCount` off the run object, and
`/v2/actor-runs` does not return that field, so every row logged `item_count = null` and
`delivered` (which requires `item_count > 0`) was always zero.

That is the worst possible failure for a canary: it would have stayed silent on the very day
the actor came back — exactly the mistake this file is a correction of, wired into code.
Fixed — WF3's canary chain now fetches each run's dataset for its real `itemCount`, records
`SUCCEEDED`-with-0-items as `BLOCKED`, and writes a real error string instead of the null a
FAILED run leaves behind.

Chain: `Read kazkn runs → Build canary rows → Fetch item counts → Merge item counts →
Log canary → Alert → Slack`.
