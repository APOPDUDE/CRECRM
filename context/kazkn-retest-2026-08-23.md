# Re-test after the author's fix — still broken (2026-08-23)

The author replied saying an older published version plus two simultaneously-down paid
providers caused the zeros, that they reproduced our exact search on a fixed version, and that
they were pushing it to our scraper.

**The build did land. It still returns zero.**

## What we tested

The tasks run `memo23/apify-loopnet-search-cheerio` (actor `RuOxoBM1bnc5pQ3TJ`) — *not*
`kazkn/commercial-real-estate-brokerage-intel` as earlier notes assumed. Same codebase family;
worth correcting because it's the actor you have to look at.

That actor was rebuilt **today at 10:58 UTC → build `0.0.285`** (previous runs were `0.0.284`),
so the fix is genuinely published. We then ran both tasks fresh at ~19:05 UTC:

| task | build | status | items | cost |
|---|---|---|---|---|
| `cre-loopnet-daily-hillsborough` (industrial + land) | 0.0.285 | **FAILED** | 0 | $0.0097 |
| `cre-loopnet-daily-hillsborough-restaurants` — **the author's own repro case** | 0.0.285 | **FAILED** | 0 | $0.0046 |

The scheduled 11:00 and 11:12 UTC runs, the first two to pick up `0.0.285`, also both failed.

## The log, from their own repro case (run `xKAa77XIVhYe2jIYM`)

```
[appcheck] App Check token expired — using the website/unblocker fallback for this run
[unblocker] scrape.do primed: lead f3b4a1e7… (1,667,902 of 3,500,000 left); 1 key(s) spent/retired.
[proxy-check] proxy 1: OK
[internal] SRP .../restaurants/hillsborough-county-fl/for-sale/: mobile search 403 (App Check) → trying token-free SRP scrape first.
[internal] SRP ...: impit attempt 1 (chrome) → 403 [hard-block]
[internal] SRP ...: impit attempt 8 (chrome) → 403 [hard-block]
[internal] SRP ...: token-free lanes blocked → falling back to website search via the paid unblocker
[unblocker] ✗ scrapedo failed search ... (status=502) — trying next provider.
[unblocker] ✗ scrapingbee returned HTTP 401 (invalid/expired API key) — DISABLING it for the
            rest of this run. Refresh the scrapingbee key.
[FAIL] Scraped 0 items across 1 start URL(s) — every source failed to return data
```

## Two places the explanation doesn't match the log

1. **"One provider hit its monthly quota, resets Aug 29."** The log shows scrape.do priming with
   **1,667,902 of 3,500,000 credits left** and then failing with **502** — a server error, not a
   quota refusal. The other provider returns **HTTP 401 invalid/expired API key**, which is also
   not a quota condition. Both are the same failures we reported on 08-18, verbatim.
2. **"Your searches were served by an older published version."** Plausible for the runs before
   today, but the two runs above are on `0.0.285`, built after the fix, and the free bypass lane
   still returns `403 [hard-block]` on all 8 attempts.

So the token-free lane is still blocked and **both** paid lanes are still down. Nothing about
our input or our proxy is implicated — `[proxy-check] proxy 1: OK`.

## Where this leaves us

No change. The live sweep stays on `azzouzana/loopnet-scraper`; kazkn/memo23 remains a canary
only, and nothing ingests from it. `select * from v_sweep_actor_health order by day desc, source;`
is the standing answer to "is it back yet".

## A canary bug this re-test exposed

`v_sweep_actor_health` reported **0 delivered on 2026-08-22 — but Pasco and Pinellas had actually
SUCCEEDED that day.** Cause: the canary read `stats.datasetItemCount` off the run object, and
`/v2/actor-runs` does not return that field, so every row logged `item_count = null` and the
`delivered` count (which requires `item_count > 0`) was always zero.

That is the worst possible failure for a canary — it would have stayed silent on the very day
kazkn came back. Fixed: WF3's canary chain now fetches each run's dataset for its real
`itemCount`, records `SUCCEEDED`-with-0-items as `BLOCKED`, and writes a real error string
instead of the null that FAILED runs leave behind (kazkn failures carry no `statusMessage`).

Chain is now: `Read kazkn runs → Build canary rows → Fetch item counts → Merge item counts →
Log canary → Alert → Slack`.
