# Archived features

Code parked here is out of the build (`tsconfig.app.json` only includes `src/`) but kept in the repo so it can be revived.

- `suggestions-widget.tsx` — the dashboard "Suggested matches" widget (archived 2026-09-03). The matching logic it renders is untouched: `suggestions` table, `refresh_suggestions()` RPC, the weekly sweep, `src/hooks/use-suggestions.ts`, and the listing-side "Recommended for" chips on property detail all still run. To revive, move the file back to `src/components/` and mount `<SuggestionsWidget />` in `src/pages/dashboard.tsx`. The matching approach is slated for a rework before that happens.
