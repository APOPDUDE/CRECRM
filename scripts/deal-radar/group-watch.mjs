/**
 * Facebook GROUP feed reader.
 *
 * The Marketplace MCP can't see groups, so this is a separate path: a real
 * logged-in browser (Playwright driving Chrome) opens each group, scrolls, and
 * scrapes the visible posts. We drive a browser rather than FB's GraphQL on
 * purpose — group post_ids and doc_ids rotate constantly, and the rendered DOM
 * survives those changes where a hand-rolled GraphQL client would break weekly.
 *
 * It runs on a DEDICATED Chrome profile (GROUP_CHROME_USER_DATA_DIR, default
 * ~/.deal-radar-chrome) so it never fights your main Chrome's profile lock. You
 * log that profile into Facebook ONCE (see README); the session persists.
 *
 * FRAGILE BY NATURE: Facebook's DOM is obfuscated and changes. Extraction here
 * is heuristic and defensive — it pulls what it can and returns [] rather than
 * throwing on a layout it doesn't recognize. Expect to tune the selectors on the
 * first real run; a zero-post scrape is logged, never fatal.
 *
 * Playwright is an OPTIONAL dependency: it's imported lazily, so the Marketplace
 * path works even when Playwright isn't installed. Install it only if you want
 * groups: `npm i playwright && npx playwright install chromium`.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { dwell, humanMouse, humanScroll, rand, sleepBetween } from './human.mjs'
import { launchOptions } from './market-watch.mjs'

/** facebook.com/groups/<id-or-slug>/... -> the id-or-slug */
export function groupIdFromUrl(url) {
  const m = String(url).match(/groups\/([^/?#]+)/i)
  return m ? m[1] : String(url)
}

const PROFILE_DIR =
  process.env.GROUP_CHROME_USER_DATA_DIR || join(homedir(), '.deal-radar-chrome')

/**
 * Scrape one group's recent posts. Returns raw post objects for normalizeGroupPost:
 * { id, text, permalink, author, image_url, created_ms }.
 */
async function scrapeGroup(page, group, { scrolls }) {
  {
    // ?sorting_setting=CHRONOLOGICAL surfaces newest first when FB honors it.
    const url = `https://www.facebook.com/groups/${group.id}/?sorting_setting=CHRONOLOGICAL`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await dwell()

    // Detect a logged-out / checkpoint wall early so the error is meaningful.
    const loggedOut = await page.evaluate(() =>
      /log in|create new account|you must log in/i.test(document.body?.innerText?.slice(0, 400) || ''),
    )
    if (loggedOut) {
      throw new Error('group profile is not logged into Facebook — see README (log the deal-radar Chrome profile in once)')
    }
    const checkpoint = await page.evaluate(() =>
      /suspicious activity|confirm your identity|we suspect automated|temporarily (?:blocked|restricted)/i.test(
        document.body?.innerText?.slice(0, 1200) || '',
      ),
    )
    if (checkpoint) throw new Error('CHECKPOINT: Facebook is showing a verification/automation notice — stop and log in by hand')

    await humanMouse(page)
    await humanScroll(page, scrolls)

    // Heuristic extraction: every anchor whose href points at a post is one post.
    // Climb to a reasonable container, take its text, first author link and image.
    const posts = await page.evaluate((groupKey) => {
      const seen = new Set()
      const out = []
      const anchors = Array.from(document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]'))
      for (const a of anchors) {
        const href = a.getAttribute('href') || ''
        const idMatch = href.match(/\/(?:posts|permalink)\/(\d+)/)
        if (!idMatch) continue
        const postId = idMatch[1]
        if (seen.has(postId)) continue

        // Walk up to the article/container that holds the post body.
        let node = a
        for (let d = 0; d < 12 && node.parentElement; d++) {
          node = node.parentElement
          if (node.getAttribute('role') === 'article' || node.tagName === 'ARTICLE') break
        }
        const text = (node.innerText || '').trim()
        if (text.length < 20) continue // skip bare "See more" / reaction chrome
        seen.add(postId)

        const authorLink = node.querySelector('a[href*="/user/"], h3 a, strong a, h2 a')
        const img = node.querySelector('img[src*="scontent"], img[referrerpolicy]')
        out.push({
          id: postId,
          text: text.slice(0, 4000),
          permalink: `https://www.facebook.com/groups/${groupKey}/posts/${postId}/`,
          author: authorLink ? (authorLink.textContent || '').trim().slice(0, 120) : null,
          image_url: img ? img.getAttribute('src') : null,
          created_ms: null, // relative timestamps aren't reliably parseable; leave null
        })
      }
      return out
    }, group.id)

    return posts
  }
}

/**
 * Read all configured groups. Returns { posts, errors } — never throws for a
 * single bad group. `posts` are raw (feed to normalizeGroupPost). Returns an
 * empty result with a clear error if Playwright isn't installed.
 */
export async function watchGroups(groups, opts = {}) {
  const scrollsMin = opts.scrollsMin ?? 3
  const scrollsMax = opts.scrollsMax ?? 7
  const paceMinMs = opts.paceMinMs ?? 90_000
  const paceMaxMs = opts.paceMaxMs ?? Math.max(paceMinMs, 240_000)

  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    return {
      posts: [],
      errors: [{ error: 'playwright not installed — run `npm i playwright && npx playwright install chromium` to watch groups' }],
    }
  }

  // Same hardened, headed options as the Marketplace pass — the two used to differ
  // (groups ran headless with no stealth args at all), which is its own tell.
  const context = await chromium.launchPersistentContext(PROFILE_DIR, launchOptions())

  const posts = []
  const errors = []
  let checkpoint = null
  const page = context.pages()[0] ?? (await context.newPage())
  try {
    for (const group of groups) {
      try {
        const got = await scrapeGroup(page, group, { scrolls: rand(scrollsMin, scrollsMax) })
        posts.push(...got.map((p) => ({ post: p, group })))
      } catch (err) {
        const msg = (err?.message ?? String(err)).slice(0, 400)
        errors.push({ group: group.name || group.id, error: msg })
        if (/^CHECKPOINT/.test(msg)) {
          checkpoint = msg
          break // stop the session cold
        }
      }
      await sleepBetween(paceMinMs, paceMaxMs)
    }
  } finally {
    await context.close().catch(() => {})
  }
  return { posts, errors, checkpoint }
}
