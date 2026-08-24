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
