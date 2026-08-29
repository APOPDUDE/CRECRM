# Deal Radar — agent kickoff (run this on the scraper Mac)

**You are a Claude Code session running on a dedicated, throwaway MacBook.** Your
job: install and schedule the **Deal Radar worker**, which finds new industrial
and land listings on Facebook Marketplace and in a few Facebook groups, and
writes them into a cloud CRM database. The listings then appear on the CRM's Deal
Radar dashboard, where a human sends outreach by hand from a *different* computer.

Because this is a throwaway box, don't be cautious about installing system tools —
go ahead and run the steps. This machine is already kept awake 24/7, so skip any
sleep/`pmset` configuration.

**Read this whole file first, then execute steps 1–7 in order.** Two steps need the
human — stop and ask when you reach them; do everything else yourself.

## Two things only the human can do (pause and ask at these points)

1. **Sign Chrome into Facebook with the burner account.** You must not enter
   Facebook credentials yourself. When a step needs a logged-in Facebook session,
   stop and ask the human to sign in, then continue.
2. **The Supabase `service_role` key.** It's a secret. You'll scaffold the `.env`
   file and open the dashboard page, but ask the human to paste the key value.
   Get it from: **Supabase → Project Settings → API → `service_role` secret**
   (https://supabase.com/dashboard/project/sxlttnxcutnrdzcldafh/settings/api).

**Security:** the GitHub repo is PUBLIC. Never write the `service_role` key (or any
secret) into a file that gets committed. It goes ONLY in `scripts/deal-radar/.env`,
which is git-ignored. Do not commit anything from this machine.

## Steps to execute

### 1. Prerequisites
Install Homebrew, Node, and Chrome if they're missing (`which node`, `which brew`,
and check for `/Applications/Google Chrome.app` first; skip what's already there):
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node
brew install --cask google-chrome
```

### 2. Human step — burner Facebook login
Ask the human to open Chrome and sign into Facebook with the **burner** account,
and to leave it signed in. This is the session the Marketplace reader replays.
(The first worker run may raise a macOS Keychain prompt — tell them to click Allow.)

### 3. Clone the repo and build the Marketplace reader
```bash
cd ~ && git clone https://github.com/APOPDUDE/CRECRM.git
cd ~ && git clone https://github.com/jdcodes1/facebook-marketplace-mcp.git
cd ~/facebook-marketplace-mcp && npm install && npm run build
```

### 4. Configure the worker
```bash
cd ~/CRECRM/scripts/deal-radar && npm install && cp .env.example .env
```
Then edit `~/CRECRM/scripts/deal-radar/.env`:
- Set `FB_MCP_PATH` to the real path for THIS machine's username — verify with
  `whoami`, e.g. `/Users/<user>/facebook-marketplace-mcp/dist/index.js`.
- Leave `SUPABASE_URL` as-is (already correct).
- **Pause and ask the human** to paste the `service_role` key into
  `SUPABASE_SERVICE_ROLE_KEY` (see "Two things" above). Open the dashboard link for
  them.

### 5. Test it end to end
```bash
cd ~/CRECRM/scripts/deal-radar && npm test
cd ~/CRECRM/scripts/deal-radar && npm start
```
`npm test` must pass. On `npm start` you want `connected to MCP` followed by lines
like `Tampa × "warehouse": N new`. It writes straight to the cloud DB, so the human
can confirm rows appear on the CRM Deal Radar page. Let it run one full cycle or
Ctrl-C after you've seen a few `new` lines. If every search errors, Facebook rotated
its query ids — run `cd ~/facebook-marketplace-mcp && npm run capture-queries && npm run build` and retry.

### 6. Enable group watching (Playwright)
The Marketplace reader can't see groups, so groups use a separate browser reader on
a dedicated Chrome profile:
```bash
cd ~/CRECRM/scripts/deal-radar && npm i playwright && npx playwright install chromium
npx playwright open --channel=chrome --user-data-dir="$HOME/.deal-radar-chrome" https://www.facebook.com/
```
The `open` command launches a browser window — **pause and ask the human** to sign
that window into Facebook with the burner account, then close it. That profile's
session persists for future headless runs. The watched groups are already in
`config.json`. Note: Facebook's group HTML is obfuscated; if a group yields 0 posts
on the first real run, report it — the selectors in `group-watch.mjs` may need a
tune. Marketplace is unaffected either way.

### 7. Schedule it (every 45 minutes)
The plist ships with my paths hard-coded. Edit
`~/CRECRM/scripts/deal-radar/com.crecrm.dealradar.plist` and replace every
`/Users/apop/CRE CRM/scripts/deal-radar` with THIS machine's path
(`/Users/<user>/CRECRM/scripts/deal-radar`) and fix the two log paths to this
user's home. Then:
```bash
cp ~/CRECRM/scripts/deal-radar/com.crecrm.dealradar.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.crecrm.dealradar.plist
tail -n 40 ~/Library/Logs/deal-radar.log
```
Confirm the agent is registered: `launchctl list | grep crecrm` should show it.

## When you're done, report to the human
- Whether the manual `npm start` produced new listings (and roughly how many).
- Whether groups returned posts or need a selector tune.
- That the launch agent is loaded and will run every 45 minutes.
- Anything you couldn't complete and why.

Full reference doc (in the repo you cloned): `~/CRECRM/scripts/deal-radar/README.md`.
To pull future updates: `cd ~/CRECRM && git pull && cd scripts/deal-radar && npm install`.
