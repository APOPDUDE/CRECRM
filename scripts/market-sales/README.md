# Market-sales worker

Weekly launchd job for the scraper Mac: downloads all six counties' appraiser **sale
files**, keeps only sales of parcels **in the CRM book**, and hands them to the n8n
webhook `market-sales-ingest`, which writes them as `market_events` (`event_type='sale'`,
source `county_sales:<county>`) and posts the #deals digest. Book-matched by construction,
so they show on the property page's history, the Market Monitor feed, and — when the owner
has a verified contact — the dashboard alert.

## Setup (once, on the scraper Mac)

```bash
cd "<repo>" && git pull
cat > scripts/market-sales/.env <<'EOF'
SUPABASE_URL=https://sxlttnxcutnrdzcldafh.supabase.co
SUPABASE_ANON_KEY=<anon key — secrets.md>
CRM_LOGIN_EMAIL=<claude-check email — secrets.md>
CRM_LOGIN_PASSWORD=<claude-check password — secrets.md>
N8N_INGEST_URL=https://n8n.ayxco.com/webhook/market-sales-ingest
SALES_INGEST_TOKEN=<token — secrets.md §market-sales>
EOF
bash scripts/market-sales/setup.sh --now
```

`--dry-run` fetches + diffs without posting; `--county pinellas` limits to one county.
State (cursors) lives in `state.json` next to the script; deleting it replays the last 30
days, which the server-side dedupe absorbs harmlessly. The worker holds **no Supabase
write credentials** — writes go through n8n's service role.

## Source quirks (learned 2026-08-31 — don't relearn)

- **Hillsborough**: `downloads.hcpafl.org` is an ASP.NET RadGrid — files come from a
  `__doPostBack` form POST (direct GETs 404). The worker scrapes VIEWSTATE and the
  `allsales_*.zip` row's control id each run. 68 MB DBF, FOLIO-keyed (the book's `folio`).
- **Pinellas**: POST `pcpao.gov/dal/databasefile/downloadDatabaseFile` with
  `hdn_tbl_name=RP_SALES&hdn_ftype=csv` (both fields or you get the literal string
  "Array"). File carries BOTH key orders; book keys are indexed both ways anyway.
- **Pasco**: `ftp01.pascopa.com` drops long transfers mid-stream (SSL record errors) —
  `fetch_resumable` retries with Range until the zip opens.
- **Polk**: `downloader.ashx?filename=ftp_sales.zip` (55 MB, full history,
  MM/DD/YYYY dates, "Disqualified" spelled out in TRNS_DSCR).
- **Sarasota**: whole `SCPA_Detailed_Data.zip` (~67 MB) for `Sales.txt`; FDOR qual codes
  01–05 = qualified.
- **Manatee**: `manatee_ccdf.zip` is parcel-level with ONLY last-sale columns — this county
  is a "last sale moved" diff, not full history.
- Sale files have **no addresses** — titles use the book's own address, matched by parcel
  digits (Pinellas needs the SEC/TWN/RNG ↔ RNG/TWN/SEC reorder; Hillsborough matches folio).
