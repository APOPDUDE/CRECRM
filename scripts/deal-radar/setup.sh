#!/bin/bash
# Deal Radar — one-shot setup for the scraper Mac.
# Runs the mechanical steps; prints the two things only you can do at the end.
# Usage:
#   bash setup.sh              # install + build + configure + test, fix plist
#   bash setup.sh --schedule   # after you've filled .env + logged in: load launchd
set -uo pipefail

REPO="$HOME/CRECRM"
MCP="$HOME/facebook-marketplace-mcp"
WORKER="$REPO/scripts/deal-radar"
say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

if [ "${1:-}" = "--schedule" ]; then
  say "Loading the launch agent"
  cp "$WORKER/com.crecrm.dealradar.plist" "$HOME/Library/LaunchAgents/" 2>/dev/null
  launchctl unload "$HOME/Library/LaunchAgents/com.crecrm.dealradar.plist" 2>/dev/null
  launchctl load "$HOME/Library/LaunchAgents/com.crecrm.dealradar.plist"
  launchctl list | grep crecrm && echo "Scheduled. Logs: ~/Library/Logs/deal-radar.log"
  exit 0
fi

# 1. Prerequisites
say "Checking prerequisites (Homebrew, Node, Chrome)"
command -v brew >/dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
command -v node >/dev/null || brew install node
[ -d "/Applications/Google Chrome.app" ] || brew install --cask google-chrome

# 2. Clone repo + build the Marketplace reader
say "Cloning repo + facebook-marketplace-mcp"
[ -d "$REPO" ] || git clone https://github.com/APOPDUDE/CRECRM.git "$REPO"
[ -d "$MCP" ] || git clone https://github.com/jdcodes1/facebook-marketplace-mcp.git "$MCP"
( cd "$MCP" && npm install && npm run build )

# 3. Worker deps + .env scaffold
say "Installing worker + Playwright (for groups)"
( cd "$WORKER" && npm install )
if [ ! -f "$WORKER/.env" ]; then
  cp "$WORKER/.env.example" "$WORKER/.env"
  # point FB_MCP_PATH at this machine's build
  sed -i '' "s#^FB_MCP_PATH=.*#FB_MCP_PATH=$MCP/dist/index.js#" "$WORKER/.env"
fi
( cd "$WORKER" && npm i playwright && npx playwright install chromium )

# 4. Rewrite the launch agent's hard-coded paths for THIS machine
say "Fixing launch-agent paths for this Mac"
sed -e "s#/Users/apop/CRE CRM/scripts/deal-radar#$WORKER#g" \
    -e "s#/Users/apop/Library/Logs#$HOME/Library/Logs#g" \
    "$WORKER/com.crecrm.dealradar.plist" > "$WORKER/com.crecrm.dealradar.plist.tmp" \
    && mv "$WORKER/com.crecrm.dealradar.plist.tmp" "$WORKER/com.crecrm.dealradar.plist"

# 5. Parser self-test
say "Running the parser self-test"
( cd "$WORKER" && npm test )

cat <<EOF

\033[1m================  ALMOST DONE — 3 manual things  ================\033[0m

1. LOG IN (Marketplace): open Chrome and sign into Facebook with the BURNER
   account. Leave it signed in.

2. SERVICE_ROLE KEY: open
     https://supabase.com/dashboard/project/sxlttnxcutnrdzcldafh/settings/api
   copy the 'service_role' secret, and paste it into:
     $WORKER/.env   ->   SUPABASE_SERVICE_ROLE_KEY=

3. LOG IN (Groups): run this, sign the window into Facebook (burner), close it:
     npx playwright open --channel=chrome --user-data-dir="\$HOME/.deal-radar-chrome" https://www.facebook.com/

THEN test it once by hand:
     cd $WORKER && npm start      # look for 'connected to MCP' + 'N new' lines

AND schedule it to run every 45 min:
     bash $WORKER/setup.sh --schedule

EOF
