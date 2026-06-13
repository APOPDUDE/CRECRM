# CRE CRM — Passover #1 (handoff for a fresh chat)

Snapshot for continuing in a new conversation. Read this + `CLAUDE.md` (the build
spec) + `docs/n8n-automation-notes.md` (automation design) first.

## What this is
Commercial real estate brokerage CRM. Stack (fixed): Vite + React + TS + Tailwind v4 +
shadcn/ui + React Router + TanStack Query + dnd-kit + date-fns; Supabase (Postgres,
Auth, Storage); GitHub → Vercel auto-deploy on `main`. Desktop-first, phone-usable, PWA later.

## Environments / access
- **Supabase project**: `sxlttnxcutnrdzcldafh` ("CRM", us-east-1). Use the Supabase MCP
  (apply_migration / execute_sql / generate_typescript_types) — project_id above.
- **Auth user**: apoplawski4@gmail.com (login works; temp pw was `AxisCRM-temp-2026!` —
  Alex may have changed it). Public signups not yet disabled (manual dashboard step).
- **GitHub**: `APOPDUDE/CRECRM` (public). Push with an inline credential helper + the
  fine-grained PAT in the macOS keychain (username APOPDUDE, Contents r/w). PAT does NOT
  have Pull-requests permission → **open/merge PRs via the Chrome MCP browser** (Alex is
  logged into GitHub there), not `gh`/API. `gh` is not installed.
- **Vercel**: prod = **crecrm-woad.vercel.app** (project "crecrm", auto-deploys `main`).
  Env vars VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY set. (`crecrm.vercel.app` w/o suffix
  is someone else's app — ignore.)
- **n8n**: `https://n8n.ayxco.com` via the n8n MCP. **Currently 530 / down** — must be
  reachable before workflows can be created.

## Shipped & merged to main (live on prod)
- **Phases 1–6** of CLAUDE.md: schema; auth + app shell; contacts/companies/properties CRUD;
  Landlord & Tenant Rep pipeline boards (Phase 4); nested property/tenant **match boards** +
  match slide-over + Promote-to-Tenant-Rep + stage-sync (Phase 5); file uploads + executed
  checklist (Phase 6). HubSpot-style kanban lanes (`stageAccent()` in
  src/components/kanban/kanban-board.tsx).
- **Tenant requirements** expansion (move-in, power, warehouse/office SF, outdoor AC,
  loading, clear height, industry, website) on the tenant board + edit dialog.
- **Tasks/renewals/activity**: `/tasks` (list + month calendar), lease-upload → auto
  renewal task 90 days before the renewal-notice date (per-match dedupe via `tasks.match_id`),
  activity log (notes with kind note/call/text/email/meeting).
- PRs #1–#5 all merged. Local `main` is at the PR #5 merge.

## THIS branch: `automation-foundation` (NOT merged, NOT pushed yet)
Schema groundwork applied to the live DB + migration files committed, but **app code/types
are untouched** (build still green). Migrations:
- `20260613000006_match_stage_add_inquiring.sql` — adds `inquiring` as the FIRST `match_stage`
  (order now: inquiring, lead, toured, loi, lease_negotiation, executed, dead).
- `20260613000007_automation_foundation.sql`:
  - `matches.flagged_new boolean` — red "new match" tag for the daily-sweep alert.
  - `properties` provenance/listing cols: `source`, `source_listing_id`, `source_url`,
    `listing_url`, `asking_price`, `asking_rate_psf`, `cap_rate_pct`, `broker_name/company/phone/email`,
    `days_on_market`, `listed_at`, `photo_urls text[]`, `scraped_at`.
  - `lease_comps` table (owner_id, property_id, match_id?, tenant_company_id?, sf,
    lease_rate_psf, lease_type, term_months, escalations, free_rent_months, ti_psf,
    commencement_date, expiration_date, executed_at, notes) + RLS + updated_at trigger.
  - `files.contact_id` — tag files to a contact for queryability.

## IMMEDIATE next steps (do these in the new chat)
1. **Regenerate types**: `generate_typescript_types` → overwrite `src/lib/database.types.ts`
   (it is currently STALE — missing the new enum value, lease_comps, the new property cols,
   matches.flagged_new, files.contact_id). Do this before any UI work.
2. **Inquiring stage UI**: add `inquiring` to `src/lib/stages.ts` — `matchStageLabels`,
   `tenantBoardStages` (first column "Inquiring"), and `matchStageSaleLabels`. Decide
   landlord-board behavior (currently property board shows lead→executed; an `inquiring`
   match has no column there — fine, scraped matches usually have no listing). `mapTenantBoardColumn`
   keeps lead→toured.
3. **Add Property = two modes** on the tenant board: keep today's manual off-market add, add a
   **"Paste LoopNet/Crexi link"** mode that POSTs to the n8n scrape webhook and drops the result
   as an `inquiring` match. (Blocked on n8n + Apify token.)
4. **New-match red tag**: tenant rep card shows a red dot/badge when any of its matches has
   `flagged_new=true`; clear on board view.
5. **lease_comps UI**: "Mark executed / add comp" on a deal capturing rate/term/escalations/
   free rent/TI; a comps view/query surface.
6. **File→contact tagging** in the upload UI; optional flattened SQL view(s) for one-line queries.
7. **n8n workflows** (once n8n is up + Apify token provided) — designs in
   `docs/n8n-automation-notes.md`: (1) scrape-by-URL webhook, (2) requirement search, (3)
   daily monitoringMode sweep + set `flagged_new`.

## Needed from Alex (blockers for automation)
1. **Apify API token** (for actor `kazkn/commercial-real-estate-brokerage-intel`).
2. **n8n back online** (n8n.ayxco.com is 530).
3. **Supabase service-role key** as an n8n credential (writes back, bypasses RLS, stays in n8n).
4. Alert pref beyond in-app red tag (email later — needs an email provider).

## Decisions already made
- Comps: **dedicated `lease_comps` table** (chosen by Alex).
- Renewal reminder fires **90 days before** the renewal-notice date; lease-date capture
  triggers on **lease OR psa** uploads to a match.
- Calendar-invite / email delivery **deferred** (needs an email provider).
- Apify actor serves all 3 systems (startUrls / city+assetClasses / monitoringMode).

## Conventions & gotchas (save yourself time)
- Code style: 2-space indent, **no semicolons**, single quotes, `@/` import alias.
- Branch per chunk off `main`; build (`npm run build` = tsc + vite) before committing;
  open PR via Chrome MCP; merge after the review fleet; sync main + branch next.
- **Review fleet**: each phase ends with a Workflow-tool adversarial review (dimensions →
  findings → adversarial verify). Ultracode toggles whether to use it by default.
- **Verifying in-browser** (Claude Preview MCP, `.claude/launch.json` "dev" port 5173):
  dnd-kit synthetic drags need ~12 pointermove steps + a ~150ms settle before pointerup, and
  drop precision is poor on far-right columns at narrow widths (resize to 1600, aim deep).
  Radix Select/Tabs/Dropdown need pointerdown+pointerup+click (+~450ms) before querying.
  Match cards: dnd wrapper AND inner card both have role=button — click the inner one
  (the one whose React props has onClick).
- Always clean up test data inserted during verification (seeded demo data should stay:
  8 companies / 8 contacts / 5 properties / 5 listings / 5 tenant_reps / 6 matches / 3 tasks).
- Memory lives at the project memory dir; `project-cre-crm-state.md` tracks status.

## Still-remaining from the original spec (after automation)
- **Phase 7 — Dashboard** (pipeline summaries, weighted fees, upcoming dates incl. renewals,
  recent-inquiry feed).
- **Phase 8 — Polish + PWA** (detail-page association views, empty states, manifest/icons,
  responsive pass, currency formatting audit).
