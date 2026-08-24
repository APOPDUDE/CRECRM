# The false "new listings" of 2026-08-22, and why off-market was fine

Alex, after the switch: *"I had a lot of 'new listings' that weren't actually new and maybe we
have marked properties as off-market not correctly."*

Two claims. **The first was real. The second was not** — the off-market guards held.

## The false new listings: real, 23 of them

WF3's `*/3` cron fired on **2026-08-22**, running the azzouzana sweep over Hillsborough + Polk
industrial. It created **79 properties, of which 23 duplicated an address already in the book.**

The tell is in the ids:

| address | new key (08-22) | key already on file | existing status |
|---|---|---|---|
| 15921 N Florida Ave, Lutz | `loopnet:40773907` | `loopnet:40773913` | on_market |
| 2925 Pavers Rd, Lakeland | `loopnet:40049821` | `loopnet:40049919` | on_market |
| 220 Recker Hwy, Auburndale | `loopnet:37183359` | `loopnet:41025789` | on_market |

**Adjacent listing ids.** Same building, sibling listings — a different suite or space. azzouzana
returns *space-level* listings; the book was keyed on memo23's *property-level* placard ids. Same
property, different LoopNet listing id, so `source_key` missed and a new row was born.

### Why the two guards that exist did not stop it

1. **The building-id bridge** (`properties.loopnet_property_id`, added `20260821160000`) is
   exactly the fix for this — resolve by building before minting. But it can only match a
   property that *already has* a building id, and before 08-22 essentially none did. azzouzana's
   first run had nothing to match against. The bridge needed a generation of data it never got.
2. **The claim-by-address step** in `import_scraped_listings` would otherwise have adopted the
   existing row — except it carries a deliberate guard from 2026-08-18:
   `and (source_key is null or (source_key not ilike 'loopnet:%' and source_key not ilike
   'crexi:%'))`. It refuses to re-key a property that is already a listing, because
   claim-by-address crosses neighbouring parcels (see `reference-listing-url-from-source-key`).
   That guard is correct and should stay. It just means address-claiming cannot rescue a
   second actor with a different id granularity.

**So this was not a bug in either guard.** It is what happens when two scrapers with *different
listing-id granularities* are pointed at the same book. Running one actor at a time avoids it
entirely — which is where we now are, since memo23 uses the original key space.

### Cleanup

The 23 carried **only scrape artifacts** — 23 `market_listings`, 25 `comps`, and zero pursuits,
deals, notes, files, units, tags or outreach targets. Nothing of Alex's was attached, so they
were deleted rather than merged.

Rollback preserved in `_rollback_azzouzana_dupes_20260824` (+ `_ml_`, `_comps_` siblings):

```sql
insert into properties      select * from _rollback_azzouzana_dupes_20260824;
insert into market_listings select * from _rollback_azzouzana_dupes_ml_20260824;
insert into comps           select * from _rollback_azzouzana_dupes_comps_20260824;
```

The other **56** properties from that run were kept: they are addresses the book genuinely did
not have.

## Off-market: checked, and it is clean

`sweep_finalize_off_market` **did** run Sunday 08-23 16:00 UTC and passed its guards
(`sweep_meta` = 723 seen, above the 300 floor). It then flipped **zero** listings and **zero**
properties:

- `market_listings` with `off_market_at` in the last 6 days: **0**
- scraped properties touched in the finalize window (08-23 15:59–16:05): **0**

Nothing was wrongly marked off-market. The 7-day staleness rule is what saved it — the broad
08-16 sweep had stamped most of the book, and 08-23 minus 7 days lands on 08-16, so almost
nothing was old enough to age out. The per-(county, property_type) gate added the same day
narrowed it further.

**Worth keeping in mind:** had the azzouzana interlude run a few days longer, those same
duplicate-keyed rows *would* have started aging the real listings out, because the originals
were no longer being re-seen under their own keys. The switch back closed that window.
