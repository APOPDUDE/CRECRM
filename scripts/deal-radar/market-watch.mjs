/**
 * Facebook MARKETPLACE search reader — browser-driven (Playwright), replacing the
 * private-GraphQL MCP reader. Facebook rewrites that API constantly (doc_id +
 * response shape); the rendered search page survives those changes.
 *
 * Runs on the DEDICATED Chrome profile (GROUP_CHROME_USER_DATA_DIR, default
 * ~/.deal-radar-chrome) that's logged into Facebook.
 *
 * HEADED, ON PURPOSE (2026-09-05). Facebook warned the account for "suspected
 * automated behavior". Playwright's headless Chrome sends
 *   User-Agent: ...HeadlessChrome/152.0.0.0...
 * on EVERY request — self-identifying automation, no clever fingerprinting needed.
 * Headed mode reports a normal "Chrome/152.0.0.0" UA and a real screen size that
 * differs from the window. Do NOT set headless:true here again.
 *
 * Everything paced/scrolled through human.mjs: partial scrolls, mouse movement,
 * dwell time, and one reused tab (a human doesn't open and destroy a tab per search).
 *
 * Playwright is imported lazily so the worker still loads without it.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chance, dwell, humanMouse, humanScroll, pause, rand } from './human.mjs'

const PROFILE_DIR =
  process.env.GROUP_CHROME_USER_DATA_DIR || join(homedir(), '.deal-radar-chrome')

/**
 * FB search URL uses a city slug; the account's saved radius applies. We also sort
 * newest-first and (optionally) cap to listings posted in the last N days, so stale
 * "listed 30 weeks ago" results stop surfacing. Override slug per market via fb_slug.
 */
function searchUrl(market, keyword, daysSinceListed) {
  const slug = market.fb_slug || 'tampa'
  const parts = [`query=${encodeURIComponent(keyword)}`, 'sortBy=creation_time_descend']
  if (daysSinceListed) parts.push(`daysSinceListed=${encodeURIComponent(String(daysSinceListed))}`)
  return `https://www.facebook.com/marketplace/${slug}/search/?${parts.join('&')}`
}

/**
 * Launch options tuned to look like an ordinary desktop Chrome. Every line here is
 * load-bearing; measured against Playwright 1.62 + Chrome 152 on this Mac.
 *
 * - headless:false — the single highest-value setting. Headless Chrome sends
 *   "HeadlessChrome/152.0.0.0" in the UA on every request while its sec-ch-ua
 *   header says "Google Chrome": a self-contradiction worse than either alone.
 * - viewport:null — Playwright's default viewport applies setDeviceMetricsOverride,
 *   which forces screen == viewport, devicePixelRatio 1 and colorDepth 24. On a
 *   Retina Mac that claims a non-Retina screen while WebGL reports Apple M1.
 *   With null we get the real 1440x900 / dpr 2 / depth 30.
 * - NO custom userAgent. Playwright derives userAgentMetadata by parsing an
 *   override, yielding architecture "x86" + platformVersion "10_15_7" on an M1 —
 *   an x86 macOS 10.15 machine with an Apple M1 GPU does not exist. Real headed
 *   Chrome is already coherent; overriding manufactures a louder signal.
 * - chromiumSandbox:true — suppresses Playwright's default --no-sandbox. Not
 *   page-detectable, but we browse the live web with a logged-in session, so
 *   running the renderer unsandboxed is a real security problem.
 * - --disable-blink-features=AutomationControlled — still required and still works
 *   (measured navigator.webdriver false). Playwright always passes
 *   --remote-debugging-pipe, which otherwise sets webdriver=true even headed.
 *   Do NOT also patch navigator.webdriver from JS: the flag removes it at the
 *   Blink level, while a JS overwrite leaves a tamperable descriptor that is
 *   itself detectable.
 * - ignoreDefaultArgs strips Playwright defaults that ARE page-observable: no
 *   bfcache (visible via pageshow.persisted), popups allowed without a user
 *   gesture, and a Finch feature set matching no real Chrome install.
 *
 * Deliberately KEPT: --password-store=basic / --use-mock-keychain (without them
 * Chrome prompts for the macOS login keychain and an unattended run hangs — this
 * bit us before) and the first-run suppression flags.
 */
export function launchOptions() {
  return {
    headless: false,
    channel: 'chrome',
    viewport: null,
    chromiumSandbox: true,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: [
      '--disable-field-trial-config',
      '--disable-back-forward-cache',
      '--disable-popup-blocking',
      '--disable-component-update',
      '--disable-extensions',
      '--disable-ipc-flooding-protection',
    ],
  }
}

/**
 * A card's innerText is a few lines: one or two prices, a title, and usually "City, ST".
 * Pull them apart defensively; a card with no title falls out (ads / bare price tiles).
 */
function parseCard(c) {
  const lines = c.lines.filter((l) => !/^(just listed|partner listing|sponsored|free)$/i.test(l))
  if (lines.length === 0) return null
  const price = lines.find((l) => /^\$[\d,]+/.test(l)) || null
  const last = lines[lines.length - 1]
  const location = last && /,\s*[A-Z]{2}\b/.test(last) ? last : null
  const title = lines.find((l) => l !== price && l !== location && !/^\$[\d,]+/.test(l) && l.length > 3)
  if (!title) return null
  return { id: c.id, title, price, location, url: c.url, image: c.image }
}

/** Read the listing cards currently in the DOM. */
async function readCards(page) {
  return page.evaluate(() => {
    const seen = new Set()
    const out = []
    for (const a of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
      const href = a.getAttribute('href') || ''
      const m = href.match(/\/marketplace\/item\/(\d+)/)
      if (!m || seen.has(m[1])) continue
      seen.add(m[1])
      const img = a.querySelector('img')
      out.push({
        id: m[1],
        lines: (a.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean),
        url: 'https://www.facebook.com' + href.split('?')[0],
        image: img ? img.getAttribute('src') : null,
      })
    }
    return out
  })
}

/**
 * One search, in the SHARED tab. Scrolls a variable number of times, moves the
 * mouse, and occasionally opens a listing and comes back — which is what a person
 * shopping actually does, and it makes the session look less like a crawler.
 */
async function scrapeSearch(page, market, keyword, { scrolls, daysSinceListed, openListingChance = 0.2 }) {
  await page.goto(searchUrl(market, keyword, daysSinceListed), {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  await dwell()

  const loggedOut = await page.evaluate(() =>
    /log in|create new account|forgot account/i.test(document.body?.innerText?.slice(0, 300) || ''),
  )
  if (loggedOut) {
    throw new Error('marketplace profile is not logged into Facebook — log the deal-radar Chrome profile in once')
  }
  // Facebook shows this interstitial when it wants a human check. Bail loudly
  // rather than hammering through it.
  const checkpoint = await page.evaluate(() =>
    /suspicious activity|confirm your identity|we suspect automated|temporarily (?:blocked|restricted)/i.test(
      document.body?.innerText?.slice(0, 1200) || '',
    ),
  )
  if (checkpoint) throw new Error('CHECKPOINT: Facebook is showing a verification/automation notice — stop and log in by hand')

  await humanMouse(page)

  // Abandon ~12% of searches after the first screen without scrolling at all —
  // people do bail on a thin result page. We still take whatever is above the fold.
  if (chance(0.12)) {
    await pause(1500, 6000)
    return (await readCards(page)).map(parseCard).filter(Boolean)
  }

  await humanScroll(page, scrolls)

  const cards = (await readCards(page)).map(parseCard).filter(Boolean)

  // Sometimes actually look at one — a real shopper clicks through. Without this
  // the account shows search impressions with a 0.00% detail-view rate forever.
  if (cards.length > 0 && chance(openListingChance)) {
    const pick = cards[rand(0, Math.min(cards.length, 8) - 1)]
    try {
      await page.goto(pick.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await dwell()
      await humanScroll(page, rand(1, 3))
      await pause(2000, 12000)
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
      await pause(1200, 4000)
    } catch {
      /* a listing that won't open is not a failure of the search */
    }
  }

  return cards
}

/**
 * Scrape every market × keyword in ONE browser session, reusing a single tab.
 * `onBatch(items, {market, keyword})` fires after each search so the worker can
 * upsert incrementally. Returns { count, errors }.
 *
 * A CHECKPOINT error aborts the whole session immediately — if Facebook is asking
 * for verification, continuing is exactly how an account gets disabled.
 */
export async function watchMarket(markets, keywords, opts = {}) {
  const scrollsMin = opts.scrollsMin ?? 3
  const scrollsMax = opts.scrollsMax ?? 7
  const paceMinMs = opts.paceMinMs ?? opts.paceMs ?? 180_000
  const paceMaxMs = opts.paceMaxMs ?? Math.max(paceMinMs, 480_000)
  const daysSinceListed = opts.daysSinceListed ?? null
  const onBatch = opts.onBatch ?? (() => {})

  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    return { count: 0, errors: [{ error: 'playwright not installed — run `npm i playwright`' }] }
  }

  const context = await chromium.launchPersistentContext(PROFILE_DIR, launchOptions())

  let count = 0
  let checkpoint = null
  const errors = []
  const page = context.pages()[0] ?? (await context.newPage())
  try {
    // Enter through Marketplace home, like opening the app, before deep-linking into
    // searches. Otherwise the session is a run of cold full-document loads of
    // pre-filtered URLs with no facebook.com referer — a sequence you cannot
    // produce through the real UI.
    try {
      await page.goto('https://www.facebook.com/marketplace/', {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      })
      await dwell()
      await humanMouse(page)
      await humanScroll(page, rand(1, 3))
      await pause(3000, 9000)
    } catch {
      /* a slow home page shouldn't kill the session */
    }

    outer: for (const market of markets) {
      for (const keyword of keywords) {
        try {
          const items = await scrapeSearch(page, market, keyword, {
            scrolls: rand(scrollsMin, scrollsMax),
            daysSinceListed,
          })
          count += items.length
          await onBatch(items, { market: market.name, keyword })
        } catch (err) {
          const msg = (err?.message ?? String(err)).slice(0, 400)
          errors.push({ market: market.name, keyword, error: msg })
          if (/^CHECKPOINT/.test(msg)) {
            checkpoint = msg
            break outer // stop the session cold
          }
        }
        await pause(paceMinMs, paceMaxMs)
      }
    }
  } finally {
    await context.close().catch(() => {})
  }
  return { count, errors, checkpoint }
}
