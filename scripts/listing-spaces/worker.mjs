/**
 * Listing-spaces worker (U3).
 *
 * The Apify placard feed can never say WHICH suites a lease listing offers — only the
 * sum, a count, and a rate range. This worker runs on the scraper Mac (launchd, 3x/day
 * ~5h apart, see com.crecrm.listingspaces.plist), opens each multi/partial-space lease
 * listing in the REAL installed Chrome (its own process + profile, attached over the
 * DevTools port — see attachRealChrome for why), reads LoopNet's "All Available
 * Spaces" grid, and writes per-suite rows through the import_listing_spaces RPC.
 * Targets come from listing_space_targets(), least-recently-scraped first, so the
 * book cycles roughly weekly at the default cap.
 *
 * Design rules (do not soften — inherited from the sweep's scars):
 * - POLITE: 15–35s jittered gap between pages, LIMIT pages per run (default 40,
 *   ~17 min). This is a trickle, not a sweep.
 * - STOP ON CHALLENGE: two consecutive bot-wall hits end the run. Hammering a wall
 *   turns a soft block into a hard one; tomorrow's run retries.
 * - A run row ALWAYS lands in listing_space_runs, even on abort — "SUCCEEDED with
 *   0 items = BLOCKED" must be visible, never inferred from absence.
 * - A 0-space extraction never marks existing suites gone (guard lives in the RPC).
 * - Never crash: exit 0 always, so launchd doesn't thrash.
 */

import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { looksLikeChallenge, toSpaceRow } from './parse.mjs'

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ALERT_WEBHOOK_URL,
  // Pacing profile (2026-08-31). The GAP is the wall-avoidance lever — kept slow
  // (2-4 min variable) since we walled inside one 13-min burst. The CAP is only a
  // ceiling: stop-on-challenge means the wall, not this number, ends a run, so the cap
  // is set HIGH (40) to let a quiet-wall day harvest fully — up to ~160/day across the
  // 4 runs, trimmed to whatever the site actually tolerates. Raising the cap costs
  // nothing on wall-y days (the run just stops early) and a lot on lenient ones. All
  // three are env-tunable: read the run log, then dial the gap DOWN or cap UP only if
  // runs are completing clean with challenges=0.
  LS_LIMIT = '40',
  LS_GAP_MIN_SEC = '120',
  LS_GAP_MAX_SEC = '240',
  LS_PROFILE_DIR = join(homedir(), '.listing-spaces-chrome'),
  LS_CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  LS_CDP_PORT = '9223',
  LS_TEST_URL,
} = process.env

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Launch the REAL installed Chrome (its own process, its own profile) and attach over
 * the DevTools port. A Playwright-launched Chrome carries automation flags and LoopNet
 * hard-denies it ("Access Denied" even on the homepage — measured 2026-08-30); a
 * normally-launched Chrome driven over CDP is just a browser and passed cleanly from
 * the same machine, same IP, same minute. Nothing is masked or spoofed: if a
 * challenge still appears, the run stops (see the challenge rules below).
 */
async function attachRealChrome() {
  const chrome = spawn(
    LS_CHROME_BIN,
    [
      `--remote-debugging-port=${LS_CDP_PORT}`,
      `--user-data-dir=${LS_PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,1200',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  const { chromium } = await import('playwright')
  let browser = null
  for (let i = 0; i < 30 && !browser; i++) {
    await sleep(500)
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${LS_CDP_PORT}`)
    } catch {
      /* not up yet */
    }
  }
  if (!browser) {
    chrome.kill()
    throw new Error(`could not attach to Chrome on port ${LS_CDP_PORT} — is ${LS_CHROME_BIN} correct?`)
  }
  const context = browser.contexts()[0] ?? (await browser.newContext())
  return { browser, chrome, context }
}

// Smoke test: LS_TEST_URL=<listing url> node worker.mjs — no DB, no env keys needed.
// Visits one page, prints the parsed suites, exits. For selector-drift debugging too.
if (LS_TEST_URL) {
  const { browser, chrome, context } = await attachRealChrome()
  try {
    const page = await context.newPage()
    await page.goto(LS_TEST_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForSelector('section.spaces-available', { timeout: 20_000 }).catch(() => {})
    const [title, bodyText] = await Promise.all([
      page.title(),
      page.evaluate(() => document.body?.innerText?.slice(0, 1200) || ''),
    ])
    if (looksLikeChallenge(title, bodyText)) {
      console.log('CHALLENGE page —', title)
    } else {
      const got = await page.evaluate(extractSpacesInPage)
      console.log(JSON.stringify((got.spaces || []).map(toSpaceRow).filter(Boolean), null, 2))
    }
  } finally {
    await browser.close().catch(() => {})
    chrome.kill()
  }
  process.exit(0)
}

for (const [name, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) {
    console.error(`[listing-spaces] missing env ${name} — see README.md`)
    process.exit(0)
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const log = (...args) => console.log(new Date().toISOString(), '[listing-spaces]', ...args)
// (sleep defined above, next to attachRealChrome)

async function alert(message) {
  console.error(new Date().toISOString(), '[listing-spaces] ALERT:', message)
  if (!ALERT_WEBHOOK_URL) return
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'listing-spaces', message }),
    })
  } catch (err) {
    console.error('[listing-spaces] alert webhook failed:', err?.message)
  }
}

// Variable gap between listings, bounded by the env profile. The randomness matters
// as much as the length — a fixed cadence is itself a bot tell.
const GAP_MIN = Math.max(5, parseInt(LS_GAP_MIN_SEC, 10) || 120) * 1000
const GAP_MAX = Math.max(GAP_MIN + 1000, (parseInt(LS_GAP_MAX_SEC, 10) || 240) * 1000)
const jitterGap = () => GAP_MIN + Math.floor(Math.random() * (GAP_MAX - GAP_MIN))

/**
 * Runs in the page. Verified live against 1575 Cattlemen Rd (2026-08-30): the LDP
 * spaces module is section.spaces-available with one .available-spaces__accordion per
 * suite; cells are li.available-spaces__one..seven; the rate cell renders only the
 * selected display option (default $/SF/YR) as __value-segment spans.
 */
function extractSpacesInPage() {
  const mod = document.querySelector('section.spaces-available')
  if (!mod) return { found: false, spaces: [] }
  const scope = mod.querySelector('.available-spaces--desktop') || mod
  const rows = [...scope.querySelectorAll('.available-spaces__accordion')]
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null)
  const cell = (row, cls) => {
    const li = row.querySelector('li.available-spaces__' + cls)
    if (!li) return null
    const segs = [...li.querySelectorAll('.available-spaces__data-item__value-segment')]
      .map(txt)
      .filter(Boolean)
    if (segs.length) return segs.join(' ')
    return txt(li.querySelector('.available-spaces__data-item__value')) || txt(li)
  }
  return {
    found: true,
    spaces: rows.map((r) => ({
      label: cell(r, 'one'),
      size: cell(r, 'two'),
      term: cell(r, 'three'),
      rate: cell(r, 'four'),
      use: cell(r, 'five'),
      build_out: cell(r, 'six'),
      available: cell(r, 'seven'),
    })),
  }
}

async function main() {
  const run = {
    started_at: new Date().toISOString(),
    pages: 0,
    pages_ok: 0,
    spaces_seen: 0,
    challenges: 0,
    errors: 0,
    error_detail: [],
  }
  let aborted = false
  let browser
  let chromeProc

  try {
    const { data: targets, error: tErr } = await supabase.rpc('listing_space_targets', {
      p_limit: parseInt(LS_LIMIT, 10) || 40,
    })
    if (tErr) throw new Error(`targets rpc: ${tErr.message}`)
    if (!targets?.length) {
      log('no targets — nothing to do')
      return
    }
    log(`${targets.length} targets`)

    const attached = await attachRealChrome()
    browser = attached.browser
    chromeProc = attached.chrome
    const page = await attached.context.newPage()

    let consecutiveChallenges = 0
    for (const t of targets) {
      if (run.pages > 0) await sleep(jitterGap())
      run.pages += 1
      try {
        await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        // The grid hydrates after load; the challenge shell never grows one.
        await page
          .waitForSelector('section.spaces-available', { timeout: 20_000 })
          .catch(() => {})

        const [title, bodyText] = await Promise.all([
          page.title(),
          page.evaluate(() => document.body?.innerText?.slice(0, 1200) || ''),
        ])
        if (looksLikeChallenge(title, bodyText)) {
          run.challenges += 1
          consecutiveChallenges += 1
          log(`CHALLENGE on ${t.source_listing_id} (${consecutiveChallenges} in a row)`)
          if (consecutiveChallenges >= 2) {
            await alert(
              `listing-spaces aborted: ${consecutiveChallenges} consecutive bot-wall hits (last on ${t.url}). Tomorrow's run retries; do NOT tighten the loop.`,
            )
            aborted = true
            break
          }
          continue
        }
        consecutiveChallenges = 0

        const got = await page.evaluate(extractSpacesInPage)
        const spaces = (got.spaces || []).map(toSpaceRow).filter(Boolean)
        if (!got.found || spaces.length === 0) {
          // A lease LDP without a readable grid = layout drift or an odd tier page.
          // Logged as an error so drift is visible; existing rows are NOT touched.
          run.errors += 1
          run.error_detail.push({
            listing: t.source_listing_id,
            error: got.found ? 'grid present but 0 rows parsed' : 'no spaces module on page',
          })
          continue
        }

        const { data, error } = await supabase.rpc('import_listing_spaces', {
          p: [{ source_listing_id: t.source_listing_id, spaces }],
        })
        if (error) throw new Error(`import rpc: ${error.message}`)
        run.pages_ok += 1
        run.spaces_seen += spaces.length
        log(
          `${t.source_listing_id}: ${spaces.length} suite(s) (${JSON.stringify(data)})`,
        )
      } catch (err) {
        run.errors += 1
        run.error_detail.push({
          listing: t.source_listing_id,
          error: (err?.message ?? String(err)).slice(0, 400),
        })
        log(`ERROR ${t.source_listing_id}: ${err?.message ?? err}`)
      }
    }
  } catch (err) {
    run.errors += 1
    run.error_detail.push({ error: `fatal: ${err?.message ?? err}`.slice(0, 500) })
    await alert(`listing-spaces could not run: ${err?.message ?? err}`)
    aborted = true
  } finally {
    await browser?.close().catch(() => {})
    chromeProc?.kill()
    run.ok = !aborted
    const { error } = await supabase
      .from('listing_space_runs')
      .insert({ ...run, finished_at: new Date().toISOString() })
    if (error) console.error('[listing-spaces] failed to record run:', error.message)
    log(
      `done: ${run.pages} pages (${run.pages_ok} ok), ${run.spaces_seen} suites, ${run.challenges} challenges, ${run.errors} errors${aborted ? ' (ABORTED)' : ''}`,
    )
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[listing-spaces] unexpected top-level failure:', err)
    process.exit(0)
  },
)
