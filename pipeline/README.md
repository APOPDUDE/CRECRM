# CRECRM enrichment pipeline

Harvests county + federal GIS layers into a **PostGIS cache**, fetches parcel
polygons for the tracked book, and (phase 2) spatial-joins them into
`parcel_enrichment` scalars. Architecture and the WHY:
`context/land-book-parcel-enrichment.md`.

**Where it runs (Alex 2026-08-21: cloud, not my machine):** the cache lives in
the hosted Supabase DB itself — dedicated `gis` schema, never exposed through
PostgREST (migration `20260821122000_gis_cache_schema.sql`) — so the compute
is stateless and runs as the scheduled GitHub Actions workflow
`.github/workflows/enrichment.yml` (Mondays, or on demand from the Actions
tab). Arm it by adding three repo Actions secrets: `GIS_PG_DSN` (Supabase
**session pooler** connection string), `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`.

Unlike the earlier DuckDB/overlay scripts, this pipeline is **committed** —
if it isn't in the repo, the next machine can't run it.

## Local development (optional)

```bash
cd pipeline
docker compose up -d          # local PostGIS on :5433
cp .env.example .env          # fill in SUPABASE_* (service key: same one n8n holds)
python -m venv .venv && . .venv/bin/activate
pip install -e .
enrichment init-db            # bootstraps the LOCAL cache only
```

## Commands

```bash
enrichment harvest                     # walk sources.yml (watermark-skips unchanged layers)
enrichment harvest --source fema_nfhl_flood --force
enrichment parcels                     # fetch tracked-book parcel polygons (resumable)
enrichment parcels --county Pasco --refresh
enrichment discover https://maps.hillsboroughcounty.org/arcgis/rest/services -k "water main,sewer" --county Hillsborough
enrichment status                      # cache freshness + gaps, loudly
```

Everything is idempotent. Re-runs skip unchanged layers and already-cached
parcels; a failed source **freezes at its last good copy** (staged atomic
swap) and shows up red in `status` — it never decays the cache.

## sources.yml

The layer registry. `url: null` entries are known gaps: they report as
`unconfigured` until located (use `discover`). `verified: false` means the URL
hasn't survived a harvest yet — the first successful harvest is the proof.
Keep the six county parcel endpoints in `parcels.py` in lockstep with
`supabase/functions/enrich-appraiser/index.ts`.

## Phase 2 (not built yet, by design)

`enrichment join` / `score` / `push` are stubs. They will: join cached layers
to `gis.parcels` in EPSG:5070, read weights from `enrichment_score_weights`,
and push per-domain payloads through `import_parcel_enrichment()` — a domain
whose sources failed that run is omitted, so stale-but-good values survive.
