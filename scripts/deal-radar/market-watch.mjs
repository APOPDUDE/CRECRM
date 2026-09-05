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
import { chance, dwell, humanMouse, humanScroll, rand, sleepBetween } from './human.mjs'

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
 * Launch options tuned to look like an ordinary desktop Chrome:
 * - headless:false so the UA has no "HeadlessChrome" and screen != window.
 * - viewport:null so the page uses the real OS window size.
 * - ignoreDefaultArgs drops Playwright's --enable-automation (the "controlled by
 *   automated test software" switch), which is trivially detectable.
 * - No --no-sandbox / --disable-dev-shm-usage: those are server-scraper tells.
 */
export function launchOptions() {
  return {
    headless: false,
    channel: 'chrome',
    viewport: null,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
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
  await humanScroll(page, scrolls)

  const cards = (await readCards(page)).map(parseCard).filter(Boolean)

  // Sometimes actually look at one — a real shopper clicks through.
  if (cards.length > 0 && chance(openListingChance)) {
    const pick = cards[rand(0, Math.min(cards.length, 8) - 1)]
    try {
      await page.goto(pick.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await dwell()
      await humanScroll(page, rand(1, 3))
      await sleepBetween(1500, 4000)
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
      await sleepBetween(3000, 9000)
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
        await sleepBetween(paceMinMs, paceMaxMs)
      }
    }
  } finally {
    await context.close().catch(() => {})
  }
  return { count, errors, checkpoint }
}
