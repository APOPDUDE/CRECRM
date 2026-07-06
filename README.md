# CRE CRM

A commercial real-estate brokerage CRM built around one idea: **a deal is a match between a
tenant/buyer and a property, and the broker works both sides.** Landlord Rep represents a
property and moves many prospects through it; Tenant Rep represents a client and moves many
candidate properties through them. Both pipelines are powered by the same underlying match
record, so the two sides stay in sync.

Single broker today, built team-ready. Installable as a PWA and used daily on phone.

## Stack

- **Frontend:** Vite + React + TypeScript, Tailwind CSS, shadcn/ui, React Router, TanStack Query,
  dnd-kit (kanban), date-fns
- **Backend:** Supabase (Postgres, Auth, Storage) — the hosted project is the only environment
- **Hosting:** GitHub → Vercel (auto-deploy on push to `main`)

## Local development

```bash
npm install
# create .env.local with your Supabase project credentials:
#   VITE_SUPABASE_URL=https://<project>.supabase.co
#   VITE_SUPABASE_ANON_KEY=<anon key>
npm run dev
```

Build gate (must pass before deploy): `npm run build` (`tsc -b && vite build`).

## Architecture notes

- **The schema is the API.** Every business rule lives in Postgres — real enums, foreign keys,
  CHECK constraints, RLS, and triggers — so external automations can read and write the database
  directly without going through the UI. No business rule lives only in frontend code.
- **Migrations only.** All schema changes are SQL migration files under `supabase/migrations/`,
  applied to the hosted project. Never edit tables ad-hoc in the dashboard.
- `src/lib/database.types.ts` mirrors the live schema and is kept in sync with migrations.

See [CLAUDE.md](CLAUDE.md) for the full build spec and the domain model.

## Deployment

Push to `main`; Vercel builds and deploys automatically. Set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` in the Vercel project's environment variables.
