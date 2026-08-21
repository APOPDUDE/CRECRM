# A working replacement scraper — verified 2026-08-21

The current actor family cannot be fixed from our side (see
[`apify-sweep-failures-2026-08-21.md`](./apify-sweep-failures-2026-08-21.md)).
`azzouzana/loopnet-scraper` **works right now on the exact URLs that fail**.

## Head-to-head, same day, same URLs

| actor | Pinellas industrial for-lease | result |
|---|---|---|
| `kazkn/commercial-real-estate-brokerage-intel` | 4-URL county run | **FAILED**, 0 items, 315 s |
| `memo23/loopnet-scraper-ppe` | same 4 URLs | **FAILED**, 0 items, 315 s |
| `azzouzana/loopnet-scraper` | same URL | **SUCCEEDED, 100 items, 17 s** |

kazkn and memo23 are the same codebase sharing one provider pool — identical logs
(`scrapedo 502`, `scrapingbee 401`, Akamai `403 [hard-block]` ×32, mobile API
`403 (App Check)`). Swapping between them changes nothing.

Pinellas has failed every day since 08-16. `azzouzana` returned a full book on the
first try.

## Capacity and cost (measured)

| start URL | status | items | cost | time |
|---|---|---|---|---|
| industrial-properties / pinellas / for-lease | SUCCEEDED | 600 (hit my cap) | $0.54 | 140 s |
| land / pinellas / for-sale | SUCCEEDED | 80 (complete) | $0.072 | 118 s |
| industrial-properties / hillsborough / for-sale | SUCCEEDED | 66 (complete) | $0.059 | 48 s |

Flat **~$0.0009 per result** (~$0.90/1000). A full 7-county × 4-URL daily sweep lands
around $3–5/day depending on book size. The current actor bills less only because it
returns nothing.

## Actor and input

Actor id `axTRSfSIGjEY0rcwp` (`azzouzana/loopnet-scraper`), rebuilt 2026-08-21.
Three input fields — note **`startUrl` is singular**, one URL per run:

```json
{ "startUrl": "https://www.loopnet.com/search/industrial-properties/pinellas-county-fl/for-lease/",
  "maxItems": 600,
  "fetchFullDetails": false }
```

So WF3 calls the actor once per URL (7 counties × 4 = 28 runs) rather than once per
county. No saved tasks are needed — n8n can pass `startUrl` dynamically, which also
removes the seven hand-maintained task configs.

## Output → our columns

| ours | theirs |
|---|---|
| `source_key` | `'loopnet:' + listingId` — same id space as today's keys, so the sweep's dedupe and `listingUrlFromSourceKey` keep working |
| `address` / `city` / `state` / `zip` | `streetAddress` / `city` / `state` / `zip` |
| `lat` / `lng` | `latitude` / `longitude` (populated — Deal Map keeps working) |
| broker | `brokerName`, `brokerCompany` |
| `photo_urls` | `images[]` |
| asking rate / price | `price` (per-SF for lease rows, absolute for sale) |
| cap rate | `capRate` |
| property type | `propertyTypeId` — **needs a mapping table to our `property_kind` enum**; `propertyType` itself came back null |

## Caveats to settle before the swap

1. **Granularity.** Pinellas industrial-for-lease returned 600+ rows against 216
   on-market Pinellas industrial/land properties in our DB. LoopNet's for-lease SRP lists
   *spaces* (`listingTypeName: "BuildingParkDirectSpaceLease"`), several per building.
   Each row carries both `listingId` and a separate `propertyId`, so the map step should
   dedupe — decide whether a property's identity is the listing or the building.
2. **`county` is null** in the output. Our county comes from appraiser/parcel data
   already, and the sweep matches on `source_key`, so this is probably fine — but
   `v_sweep_coverage` groups by county, so confirm nothing regresses.
3. **`propertyTypeId` mapping** must be built (14 = flex/industrial in the sample).
4. **Single URL per run** — WF3 loops instead of passing an array.

## What is left

Repointing WF3 at this actor is an n8n change; n8n.ayxco.com is up but this session has
no n8n API key. Nothing in the DB needs to change: `import_scraped_listings`,
`sweep_stamp_seen` and `sweep_finalize_off_market` all key off `source_key`, which is
unchanged.
