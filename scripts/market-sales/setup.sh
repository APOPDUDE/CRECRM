#!/bin/bash
# Market-sales worker — scraper-Mac setup (mirrors deal-radar/listing-spaces: path-agnostic).
# Usage: bash scripts/market-sales/setup.sh          (installs weekly launchd job)
#        bash scripts/market-sales/setup.sh --now    (also runs once immediately)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.crecrm.market-sales.plist"

if [ ! -f "$HERE/.env" ]; then
  echo "✗ $HERE/.env is missing. Create it with these five lines (values in secrets.md):"
  echo "    SUPABASE_URL=..."
  echo "    SUPABASE_ANON_KEY=..."
  echo "    CRM_LOGIN_EMAIL=..."
  echo "    CRM_LOGIN_PASSWORD=..."
  echo "    N8N_INGEST_URL=https://n8n.ayxco.com/webhook/market-sales-ingest"
  echo "    SALES_INGEST_TOKEN=..."
  exit 1
fi

command -v python3 >/dev/null || { echo "✗ python3 not found"; exit 1; }

mkdir -p "$HERE/logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.crecrm.market-sales</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string>
    <string>$HERE/run.sh</string>
  </array>
  <key>StartCalendarInterval</key><dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>6</integer>
    <key>Minute</key><integer>45</integer>
  </dict>
  <key>StandardOutPath</key><string>$HERE/logs/worker.log</string>
  <key>StandardErrorPath</key><string>$HERE/logs/worker.log</string>
</dict></plist>
EOF

PLIST2="$HOME/Library/LaunchAgents/com.crecrm.market-distress.plist"
cat > "$PLIST2" <<EOF2
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.crecrm.market-distress</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string>
    <string>$HERE/run.sh</string>
    <string>--county</string>
    <string>distress</string>
  </array>
  <key>StartCalendarInterval</key><dict>
    <key>Hour</key><integer>7</integer>
    <key>Minute</key><integer>10</integer>
  </dict>
  <key>StandardOutPath</key><string>$HERE/logs/distress.log</string>
  <key>StandardErrorPath</key><string>$HERE/logs/distress.log</string>
</dict></plist>
EOF2

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
launchctl unload "$PLIST2" 2>/dev/null || true
launchctl load "$PLIST2"
echo "✓ launchd jobs installed: full run Mondays 6:45am → logs/worker.log; distress daily 7:10am → logs/distress.log"

if [ "${1:-}" = "--now" ]; then
  echo "— running once now (this downloads ~300 MB of county files; a few minutes)…"
  /usr/bin/python3 "$HERE/worker.py"
fi
