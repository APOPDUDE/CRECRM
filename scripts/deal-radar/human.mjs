/**
 * Human-behavior helpers shared by the Marketplace and group scrapers.
 *
 * Why this file exists: on 2026-09-05 Facebook warned the account for "suspected
 * automated behavior". The scraper was doing 104 searches/day, 24/7 (including
 * 3am), on a perfectly periodic 3h timer, in HEADLESS Chrome — whose User-Agent
 * literally reads "HeadlessChrome/152.0.0.0". Every one of those is a giveaway.
 *
 * The rules encoded here:
 * - Never a fixed delay. Every pause is a range, and ranges overlap so the
 *   distribution has no tell-tale spikes.
 * - Scroll in partial, variable steps like a person reading — never one jump to
 *   document.scrollHeight.
 * - Move the mouse. A session with zero pointer events is not a human session.
 * - Sometimes do nothing useful (idle, scroll back up, abandon). Perfect
 *   efficiency is itself a signal.
 */

/** Random integer in [min, max]. */
export function rand(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1))
}

/** Random float in [min, max). */
export function randF(min, max) {
  return min + Math.random() * (max - min)
}

/** True with probability p (0..1). */
export function chance(p) {
  return Math.random() < p
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Sleep a random duration in [min,max] ms. */
export const sleepBetween = (min, max) => sleep(rand(min, max))

/** Fisher-Yates, returns a NEW array — used to vary keyword order every session. */
export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Scroll like a person skimming a feed: partial viewport-sized steps, variable
 * distance and pause, an occasional scroll back up (re-reading something), and a
 * longer "stopped to look at this one" pause now and then. Returns when it has
 * done `steps` downward moves.
 */
export async function humanScroll(page, steps, opts = {}) {
  const minPause = opts.minPause ?? 900
  const maxPause = opts.maxPause ?? 2600
  for (let i = 0; i < steps; i++) {
    // 60-95% of a viewport per step — a real scroll wheel/trackpad, not a jump.
    const frac = randF(0.6, 0.95)
    await page.evaluate((f) => window.scrollBy({ top: window.innerHeight * f, behavior: 'smooth' }), frac)
    await sleepBetween(minPause, maxPause)

    // Occasionally pause longer, as if reading a card.
    if (chance(0.25)) await sleepBetween(1800, 5000)

    // Occasionally scroll back up a little, then continue.
    if (chance(0.15)) {
      await page.evaluate((f) => window.scrollBy({ top: -window.innerHeight * f, behavior: 'smooth' }), randF(0.2, 0.5))
      await sleepBetween(1200, 3000)
    }
  }
}

/**
 * A few idle mouse moves across the viewport. Cheap, but a session with zero
 * pointer events is a strong bot signal.
 */
export async function humanMouse(page, moves = rand(2, 5)) {
  let size = page.viewportSize()
  if (!size) {
    // viewport:null (real window) — read the live inner size instead.
    size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })).catch(() => null)
  }
  if (!size) return
  for (let i = 0; i < moves; i++) {
    const x = rand(40, Math.max(60, size.width - 40))
    const y = rand(60, Math.max(80, size.height - 60))
    // steps>1 interpolates the path instead of teleporting the cursor.
    await page.mouse.move(x, y, { steps: rand(6, 18) }).catch(() => {})
    await sleepBetween(180, 900)
  }
}

/** Dwell on a freshly loaded page as if actually looking at it. */
export const dwell = () => sleepBetween(2500, 7000)

/**
 * Is `date` inside the local active-hours window? Humans don't browse Marketplace
 * at 3am every night; running only in waking hours removes a glaring pattern.
 */
export function isActiveHours(date = new Date(), startHour = 8, endHour = 22) {
  const h = date.getHours()
  return h >= startHour && h < endHour
}

/**
 * Pick `n` items starting after the last-used index, wrapping around — so every
 * keyword still gets covered across sessions without running all of them each
 * time. Returns { picked, nextCursor }.
 */
export function rotate(arr, n, cursor = 0) {
  if (arr.length === 0) return { picked: [], nextCursor: 0 }
  const take = Math.min(n, arr.length)
  const picked = []
  let i = cursor % arr.length
  for (let k = 0; k < take; k++) {
    picked.push(arr[i])
    i = (i + 1) % arr.length
  }
  return { picked, nextCursor: i }
}
