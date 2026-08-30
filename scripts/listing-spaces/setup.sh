#!/bin/bash
# Listing spaces — one-shot setup for the scraper Mac (same conventions as
# ../deal-radar/setup.sh: repo lives wherever it lives, paths derived from this
# script's own location, plist rewritten for THIS machine at schedule time).
# Usage:
#   bash setup.sh              # install + configure + parser test + live smoke test
#   bash setup.sh --schedule   # after the smoke test prints suites: load launchd
set -uo pipefail

WORKER="$(cd "$(dirname "$0")" && pwd)"
say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

if [ "${1:-}" = "--schedule" ]; then
  say "Writing the launch agent with this machine's paths + loading it"
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  sed -e "s#/Users/apop/CRE CRM/scripts/listing-spaces#$WORKER#g" \
      -e "s#/Users/apop/Library/Logs#$HOME/Library/Logs#g" \
      "$WORKER/com.crecrm.listingspaces.plist" > "$HOME/Library/LaunchAgents/com.crecrm.listingspaces.plist"
  launchctl unload "$HOME/Library/LaunchAgents/com.crecrm.listingspaces.plist" 2>/dev/null
  launchctl load "$HOME/Library/LaunchAgents/com.crecrm.listingspaces.plist"
  launchctl list | grep crecrm.listingspaces && echo "Scheduled daily 07:10. Logs: ~/Library/Logs/listing-spaces.log"
  exit 0
fi

say "Checking prerequisites (Node, Chrome)"
command -v node >/dev/null || { echo "node missing — run the deal-radar setup.sh first"; exit 1; }
[ -d "/Applications/Google Chrome.app" ] || { echo "Google Chrome missing — brew install --cask google-chrome"; exit 1; }

say "Installing worker deps"
( cd "$WORKER" && npm install )

say "Configuring .env"
if [ ! -f "$WORKER/.env" ]; then
  if [ -f "$WORKER/../deal-radar/.env" ]; then
    cp "$WORKER/../deal-radar/.env" "$WORKER/.env"
    echo "Copied ../deal-radar/.env (same SUPABASE_URL + service_role key; extra FB vars are ignored)."
  else
    echo "NO ../deal-radar/.env found — create $WORKER/.env with SUPABASE_URL= and SUPABASE_SERVICE_ROLE_KEY= before scheduling."
  fi
fi

say "Parser self-test (offline)"
( cd "$WORKER" && npm test )

say "Live smoke test — a Chrome window opens for ~30s, no DB writes"
( cd "$WORKER" && LS_TEST_URL='https://www.loopnet.com/Listing/1575-Cattlemen-Rd-Sarasota-FL/34383202/' node worker.mjs )

cat <<EOF

If the smoke test printed suites (2,637 SF @ \$15 and 3,080 SF @ \$8), schedule it:

    bash $WORKER/setup.sh --schedule

If it printed 'CHALLENGE page' instead: do nothing and rerun later — never loop it.
EOF
