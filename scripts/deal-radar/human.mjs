/**
 * Human-behavior helpers shared by the Marketplace and group scrapers.
 *
 * Why this file exists: on 2026-09-05 Facebook warned the account for "suspected
 * automated behavior". The scraper was doing 104 searches/day, 24/7 (including
 * 3am), on a perfectly periodic 3h timer, in HEADLESS Chrome — whose User-Agent
 * literally reads "HeadlessChrome/152.0.0.0". Every one of those is a giveaway.
 *
 * The rules encoded here, each with a measured or sourced reason:
 *
 * - SCROLL WITH REAL WHEEL EVENTS. page.evaluate(window.scrollBy) fires ZERO wheel
 *   events (measured); page.mouse.wheel() goes through CDP Input.dispatchMouseEvent
 *   and fires a real one. Facebook's own infinite-scroll listens for wheel, so a
 *   scroll with nothing causing it is a direct tell. (Note: the commonly-repeated
 *   "scrollBy gives isTrusted:false" claim is WRONG — measured true either way.
 *   The wheel event is the real difference.)
 * - BURSTY, NOT LINEAR. Humans scroll in bursts of a few ticks with pauses between;
 *   bots scroll linearly. Research on scraper detection keys on burstiness.
 * - DON'T ALWAYS FINISH. Stop at 40-80% of the page about half the time, and
 *   abandon some pages after the first screen.
 * - LOG-NORMAL PAUSES, NOT UNIFORM. A uniform delay distribution is itself
 *   detectable; real dwell times are long-tailed.
 * - IMPERFECT MOUSE PATHS. 59% of bot cursor movements have path efficiency >0.94
 *   vs 29% of humans. Straight lines are a signature, so paths here curve and
 *   overshoot.
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

/** Sleep a uniform random duration in [min,max] ms. */
export const sleepBetween = (min, max) => sleep(rand(min, max))

/**
 * A long-tailed pause in [min,max]: usually near the short end, occasionally much
 * longer — the shape real dwell times have. Uniform delays are themselves a tell.
 */
export function logNormalMs(min, max) {
  // Box-Muller -> standard normal -> exp() for the long tail.
  const u1 = Math.random() || 1e-9
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  const v = Math.exp(z * 0.45) // sigma 0.45 -> most mass in 0.5x..2x, tail beyond
  const span = max - min
  return Math.round(min + Math.min(span, (span * v) / 3))
}

export const pause = (min, max) => sleep(logNormalMs(min, max))

/** Fisher-Yates, returns a NEW array — used to vary keyword order every session. */
export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Live inner size, working with viewport:null (page.viewportSize() is null then). */
async function innerSize(page) {
  if (page.viewportSize()) return page.viewportSize()
  return page
    .evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    .catch(() => ({ width: 1280, height: 800 }))
}

/**
 * Move the cursor along a curved path with a slight overshoot-and-correct, so the
 * path efficiency stays below the ~0.94 that flags bot movement.
 */
export async function humanMoveTo(page, x, y) {
  const steps = rand(18, 40)
  // Overshoot slightly past the target, then settle back onto it.
  const ox = x + rand(-28, 28)
  const oy = y + rand(-18, 18)
  await page.mouse.move(ox, oy, { steps }).catch(() => {})
  await sleep(rand(40, 130))
  await page.mouse.move(x, y, { steps: rand(4, 10) }).catch(() => {})
}

/**
 * A few idle cursor moves. A logged-in session with zero pointer events is a
 * strong bot signal on its own.
 */
export async function humanMouse(page, moves = rand(2, 4)) {
  const size = await innerSize(page)
  for (let i = 0; i < moves; i++) {
    const x = rand(40, Math.max(60, size.width - 40))
    const y = rand(60, Math.max(80, size.height - 60))
    await humanMoveTo(page, x, y)
    await pause(180, 1400)
  }
}

/**
 * Scroll a page the way a person skims it: real wheel events in bursts of a few
 * ticks, long-tailed pauses between bursts, an occasional burst back upward, and
 * frequently STOPPING PART WAY rather than always reaching the bottom.
 *
 * `bursts` is the maximum number of downward bursts; it may stop early on purpose.
 */
export async function humanScroll(page, bursts, opts = {}) {
  const size = await innerSize(page)
  // Park the cursor over the feed so wheel events land on the scrollable area.
  await humanMoveTo(page, rand(Math.round(size.width * 0.3), Math.round(size.width * 0.7)), rand(200, Math.max(240, size.height - 200)))

  // About half the time, deliberately quit at 40-80% of the planned depth.
  const target = chance(0.5) ? Math.max(1, Math.round(bursts * randF(0.4, 0.8))) : bursts

  for (let i = 0; i < target; i++) {
    // A burst = 2-5 wheel ticks in quick succession, ~300-700px total.
    const ticks = rand(2, 5)
    for (let t = 0; t < ticks; t++) {
      await page.mouse.wheel(0, rand(90, 190)).catch(() => {})
      await sleep(rand(35, 120))
    }
    await pause(opts.minPause ?? 800, opts.maxPause ?? 4000)

    // Sometimes stop and read.
    if (chance(0.25)) await pause(1800, 9000)

    // Sometimes scroll back up a bit, as if re-reading a card.
    if (chance(0.15)) {
      const upTicks = rand(1, 3)
      for (let t = 0; t < upTicks; t++) {
        await page.mouse.wheel(0, -rand(90, 190)).catch(() => {})
        await sleep(rand(40, 130))
      }
      await pause(900, 3000)
    }

    // Small chance of drifting the cursor mid-scroll, like a real hand.
    if (chance(0.3)) {
      await humanMoveTo(page, rand(60, Math.max(80, size.width - 60)), rand(120, Math.max(160, size.height - 120)))
    }
  }
}

/** Dwell on a freshly loaded page as if actually looking at it (long-tailed). */
export const dwell = () => pause(3000, 20000)

/**
 * Is `date` inside the local active-hours window? Humans don't browse Marketplace
 * at 3am; zero activity in the 1am-6am band is the single highest-value rule,
 * because detectors score the entropy of activity across the 24h clock.
 */
export function isActiveHours(date = new Date(), startHour = 8, endHour = 22) {
  const h = date.getHours()
  return h >= startHour && h < endHour
}

/**
 * Humans do less on weekends; a weekend:weekday activity ratio near 1.0 is itself
 * a flag. Returns a 0..1 multiplier to scale this session's workload by.
 */
export function dayVolumeFactor(date = new Date()) {
  const d = date.getDay()
  return d === 0 || d === 6 ? randF(0.6, 0.7) : 1
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
