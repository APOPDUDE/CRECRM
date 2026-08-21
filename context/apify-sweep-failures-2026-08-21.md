# Why the county sweep actors fail (2026-08-21, verified against the Apify API)

**Answer: it is not our options.** All six county tasks are correctly configured and
byte-identical apart from the county slug. The actor's own paid unblocker chain broke on
2026-08-18 and nobody told the author.

> Supersedes the first two passes of this file. Before the Apify API was reachable I
> inferred from two pasted inputs that the county tasks had drifted apart and that a
> `restaurants` URL was a mangled Hillsborough task. **Both were wrong.** The task
> inventory below is read from the live API.

## The tasks (read from `/v2/actor-tasks`)

| task id | name | in daily sweep |
|---|---|---|
| `gUy4mXo9aYXP0oGI0` | cre-loopnet-daily-hillsborough | yes |
| `Nfy1dXEGlLJzbIcfg` | cre-loopnet-daily-sarasota | yes |
| `MsKLfh5SVTZ0TXaSQ` | cre-loopnet-daily-manatee | yes |
| `ZWXqqz5scUcEV2trT` | cre-loopnet-daily-pinellas | yes |
| `v7yVJiUl7NvpYbJh5` | cre-loopnet-daily-pasco | yes |
| `4nrQonEyC44QqArK9` | cre-loopnet-daily-polk | yes |
| `VM2yVaoBnL8AfgwUO` | cre-loopnet-daily-hillsborough-**restaurants** | yes |
| `y1AIrIDEUY635m9RH` | cre-loopnet-hillsborough (adds flex-properties) | no |
| `2AxcpquGkQXn6Nt9y` | cre-crexi-hillsborough | no |
| `PeX9IcmoxXAGrliup` | loopnet-scraper-ppe-task | no |

The six county tasks share one input exactly:

```
https://www.loopnet.com/search/industrial-properties/{county}-county-fl/for-lease/
https://www.loopnet.com/search/industrial-properties/{county}-county-fl/for-sale/
https://www.loopnet.com/search/land/{county}-county-fl/for-lease/
https://www.loopnet.com/search/land/{county}-county-fl/for-sale/
```
```json
{"downloadImages": false, "enablePriceMonitoring": false, "includeListingDetails": false,
 "includePortfolioProperties": false, "monitoringMode": false, "moreResults": true,
 "proxy": {"apifyProxyGroups": ["RESIDENTIAL"], "useApifyProxy": true},
 "transactionTrackingMode": false}
```

Nothing to fix here. Note there is **no Hernando task** — Hernando rows arrive as spillover
from the Pasco run, which is why 24 of its 29 on-market listings have never been stamped.

## What actually happens in a failing run

The actor tries three lanes per search URL:

1. **LoopNet mobile API** — needs a Firebase App Check token; returns `403 (App Check)`.
2. **`impit` direct scrape** — Akamai answers `403 [hard-block]`, 8 attempts, then gives up.
3. **Paid unblockers** — `scrapedo` → `502`; `scrapingbee` → **`HTTP 401
   (invalid/expired API key) — DISABLING it for the rest of this run. Refresh the
   scrapingbee key.`**

All lanes dead ⇒ 0 items ⇒ the actor deliberately fails the run:

> `[FAIL] Scraped 0 items across 4 start URL(s) — every source failed to return data
> (upstream block, fetch failure, or geocoding failure) … Treating the run as failed.`

Our residential proxy is fine — the same logs show `[proxy-check] proxy 1: OK`.
`maxUnblockerRequests` is not binding either: the cap is 50/run and a failing run makes
about 4 fallback attempts before giving up.

## The timeline that proves it

Runs per day across the six county tasks, with how many logged each provider failure:

| day | runs | succeeded | scrapingbee 401 | scrapedo 502 |
|---|---|---|---|---|
| 08-10 | 6 | **6** | 0 | 6 |
| 08-15 | 6 | **6** | 0 | 6 |
| 08-16 | 6 | **6** | 0 | 6 |
| 08-17 | 6 | 2 | 0 | 6 |
| 08-18 | 6 | 1 | **6** | 6 |
| 08-19 | 6 | 2 | 6 | 6 |
| 08-20 | 10 | 3 | 10 | 10 |
| 08-21 | 10 | 1 | 10 | 10 |

- `scrapedo` has been returning 502 the whole time — chronic, and survivable.
- Through **08-16 the sweep was 6/6 every day**. `scrapingbee` was carrying it.
- **08-17**: Akamai tightened; the token-free lane started losing. Success fell to 2/6.
- **08-18**: `scrapingbee`'s key expired. The last working paid lane died and success has
  never recovered.

Akamai `403 [hard-block]` appears 25–32 times in *successful* runs too, so blocking alone
isn't the discriminator — it's whether any lane survives to fetch a page. With two of three
lanes permanently down, each run is a coin flip on the one flaky lane left.

## Who can fix what

`scrapingbee` and `scrapedo` are the **actor author's** accounts. The actor's input schema
has 32 fields; the only credential-ish ones are `firebaseAppCheckToken` (documented "leave
this blank", short-lived) and `maxUnblockerRequests` (a cost cap). **There is no field for
provider keys — we cannot fix this from our side.**

The actor (`kazkn/commercial-real-estate-brokerage-intel`) was last built **2026-08-09**,
before the breakage, so the author almost certainly doesn't know.

**Alex → report the expired scrapingbee key to the actor author on the Apify actor's
issues page.** Quote the log line; it names the fix.

Meanwhile, in our control:

- **More retry waves.** Per-run success is running ~10–30%. Four waves a county per day
  puts at-least-one-success near 60% instead of 20%, for about $1.40/day in run fees.
  n8n-side change (n8n.ayxco.com is up).
- **Crexi as a second source.** `cre-crexi-hillsborough` already exists and Crexi isn't
  behind Akamai. Needs DB work too — `sweep_finalize_off_market` excludes `crexi:` keys
  from the diff on purpose.
- **Leave the guards alone.** `sweep_finalize_off_market` has been returning
  `seen_below_floor` since 08-16, so nothing has been wrongly flipped off-market. The
  off-market picture is stale, not corrupted, and it will refill on its own once the
  actor's lanes come back.

## Open question for Alex

`cre-loopnet-daily-hillsborough-restaurants` is deliberately named and does succeed
sometimes (08-19: 25 items). But `restaurants` maps to retail, and the off-market diff and
`v_sweep_coverage` both filter to industrial + land — so it contributes nothing to the
sweep while counting as a seventh "failed county run" in the retry bot's tally. Keep it,
but should it move out of the daily-sweep group?

## Diagnostics added earlier today

`supabase/migrations/20260821140000_sweep_coverage_views.sql` — `v_sweep_coverage`
(per-county freshness, `fresh_today` mirroring finalize's gate) and `v_sweep_ingests`
(which runs delivered anything). Read-only, still valid.
