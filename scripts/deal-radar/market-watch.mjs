/**
 * Facebook MARKETPLACE search reader — browser-driven (Playwright), replacing the
 * private-GraphQL MCP reader. Facebook rewrites that API constantly (doc_id + response
 * shape); the rendered search page survives those changes, same rationale as group-watch.
 *
 * Runs on the DEDICATED Chrome profile (GROUP_CHROME_USER_DATA_DIR, default
 * ~/.deal-radar-chrome) that's logged into Facebook. Loops keywords through the
 * Marketplace search results page, scrolls, and scrapes the visible listing cards.
 *
 * Playwright is imported lazily so the worker still loads without it.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROFILE_DIR =
  process.env.GROUP_CHROME_USER_DATA_DIR || join(homedir(), '.deal-radar-chrome')

/** FB search URL uses a city slug; the account's saved radius applies. Override per market via fb_slug. */
function searchUrl(market, keyword) {
  const slug = market.fb_slug || 'tampa'
  return `https://www.facebook.com/marketplace/${slug}/search/?query=${encodeURIComponent(keyword)}`
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

async function scrapeSearch(context, market, keyword, { scrolls, delayMs }) {
  const page = await context.newPage()
  try {
    await page.goto(searchUrl(market, keyword), { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(3000)
    const loggedOut = await page.evaluate(() =>
      /log in|create new account|forgot account/i.test(document.body?.innerText?.slice(0, 300) || ''),
    )
    if (loggedOut) {
      throw new Error('marketplace profile is not logged into Facebook — log the deal-radar Chrome profile in once')
    }
    for (let i = 0; i < scrolls; i++) {
      await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight))
      await page.waitForTimeout(delayMs)
    }
    const cards = await page.evaluate(() => {
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
    return cards.map(parseCard).filter(Boolean)
  } finally {
    await page.close().catch(() => {})
  }
}

/**
 * Scrape every market × keyword. `onBatch(items, {market, keyword})` fires after each
 * search so the worker can upsert incrementally. Returns { count, errors }.
 */
export async function watchMarket(markets, keywords, opts = {}) {
  const scrolls = opts.scrolls ?? 5
  const delayMs = opts.delayMs ?? 1500
  const paceMinMs = opts.paceMinMs ?? opts.paceMs ?? 3000
  const paceMaxMs = opts.paceMaxMs ?? paceMinMs
  const onBatch = opts.onBatch ?? (() => {})

  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    return { count: 0, errors: [{ error: 'playwright not installed — run `npm i playwright`' }] }
  }

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1360, height: 1600 },
  })

  let count = 0
  const errors = []
  try {
    for (const market of markets) {
      for (const keyword of keywords) {
        try {
          const items = await scrapeSearch(context, market, keyword, { scrolls, delayMs })
          count += items.length
          await onBatch(items, { market: market.name, keyword })
        } catch (err) {
          errors.push({ market: market.name, keyword, error: (err?.message ?? String(err)).slice(0, 400) })
        }
        await new Promise((r) => setTimeout(r, paceMinMs + Math.floor(Math.random() * Math.max(0, paceMaxMs - paceMinMs))))
      }
    }
  } finally {
    await context.close().catch(() => {})
  }
  return { count, errors }
}
