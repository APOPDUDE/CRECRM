/**
 * Deal Radar ingestion worker.
 *
 * Runs on the Mac (launchd, see com.crecrm.dealradar.plist). Drives a logged-in
 * Chrome via Playwright over the dedicated ~/.deal-radar-chrome profile: scrapes
 * Facebook Marketplace SEARCH results (market-watch) and CRE group posts
 * (group-watch), normalizes/classifies hits, and inserts only NEW industrial/land
 * rows into deal_radar (dedupe on external_id).
 *
 * We read the RENDERED page, not Facebook's private GraphQL — that API rotates its
 * doc_id and response shape constantly; the DOM survives those changes.
 *
 * Design rules (do not soften):
 * - Paced between searches (pace_min_ms..pace_max_ms) so we browse like a human.
 * - Never crash: every search is try/caught, every failure counted + logged, and a
 *   run row lands in deal_radar_runs even on abort.
 * - READS only. It never messages anyone.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { normalizeGroupPost, normalizeListing } from './normalize.mjs'
import { groupIdFromUrl, watchGroups } from './group-watch.mjs'
import { watchMarket } from './market-watch.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const config = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'))

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALERT_WEBHOOK_URL } = process.env

for (const [name, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) {
    console.error(`[deal-radar] missing env ${name} — see README.md`)
    process.exit(0) // launchd should not thrash on a config error
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const PACE_MIN_MS = config.pace_min_ms ?? 300_000 // min gap between searches (default 5 min)
const PACE_MAX_MS = config.pace_max_ms ?? 600_000 // max gap between searches (default 10 min)

const log = (...args) => console.log(new Date().toISOString(), '[deal-radar]', ...args)

async function alert(message) {
  console.error(new Date().toISOString(), '[deal-radar] ALERT:', message)
  if (!ALERT_WEBHOOK_URL) return
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'deal-radar', message }),
    })
  } catch (err) {
    console.error('[deal-radar] alert webhook failed:', err?.message)
  }
}

/** Insert only-new industrial/land rows (dedupe within the batch + on external_id). */
async function upsertRows(rows) {
  if (rows.length === 0) return 0
  const seen = new Set()
  const unique = rows.filter((r) => !seen.has(r.external_id) && seen.add(r.external_id))
  const { data, error } = await supabase
    .from('deal_radar')
    .upsert(unique, { onConflict: 'external_id', ignoreDuplicates: true })
    .select('external_id')
  if (error) throw new Error(`supabase insert: ${error.message}`)
  return data?.length ?? 0
}

async function main() {
  const run = {
    started_at: new Date().toISOString(),
    searches: 0,
    hits: 0,
    inserted: 0,
    errors: 0,
    error_detail: [],
  }
  let aborted = false

  // Marketplace pass — browser scrape of the rendered search results page.
  try {
    const totalSearches = (config.markets?.length ?? 0) * (config.keywords?.length ?? 0)
    const { errors } = await watchMarket(config.markets, config.keywords, {
      scrolls: config.market_scrolls ?? 5,
      paceMinMs: PACE_MIN_MS,
      paceMaxMs: PACE_MAX_MS,
      daysSinceListed: config.days_since_listed ?? 7,
      onBatch: async (items, { market, keyword }) => {
        run.searches += 1
        const rows = items.map((it) => normalizeListing(it, { market, keyword })).filter(Boolean)
        run.hits += rows.length
        try {
          const inserted = await upsertRows(rows)
          run.inserted += inserted
          if (inserted) log(`${market} × "${keyword}": ${inserted} new (${items.length} cards)`)
        } catch (err) {
          run.errors += 1
          run.error_detail.push({ market, keyword, error: (err?.message ?? String(err)).slice(0, 500) })
          log(`ERROR upsert ${market} × "${keyword}": ${err?.message ?? err}`)
        }
      },
    })
    for (const e of errors) {
      run.errors += 1
      run.error_detail.push(e)
      log(`market ERROR ${e.keyword ?? ''}: ${e.error}`)
    }
    // Every search failed (logged out / all pages error) and nothing landed => alert.
    if (totalSearches > 0 && errors.length >= totalSearches && run.inserted === 0) {
      await alert(
        `deal-radar marketplace scrape got nothing across ${totalSearches} searches — ${errors[0]?.error ?? 'unknown'}. Check the ~/.deal-radar-chrome Facebook login.`,
      )
      aborted = true
    }
  } catch (err) {
    run.errors += 1
    run.error_detail.push({ error: `market fatal: ${err?.message ?? err}`.slice(0, 500) })
    await alert(`deal-radar marketplace scrape failed to start: ${err?.message ?? err}`)
    aborted = true
  }

  // Group pass — same dedicated profile, runs after the marketplace pass releases it.
  // A group failure never aborts the marketplace results already banked.
  const groups = (config.groups ?? []).map((g) => ({
    id: groupIdFromUrl(g.url),
    name: g.name,
    market: g.market,
  }))
  if (groups.length > 0) {
    run.searches += groups.length
    try {
      const { posts, errors } = await watchGroups(groups, {
        scrolls: config.group_scrolls ?? 6,
        delayMs: 1500,
      })
      for (const e of errors) {
        run.errors += 1
        run.error_detail.push({ source: 'group', ...e })
        log(`group ERROR ${e.group ?? ''}: ${e.error}`)
      }
      const groupRows = posts.map(({ post, group }) => normalizeGroupPost(post, group)).filter(Boolean)
      run.hits += groupRows.length
      try {
        const inserted = await upsertRows(groupRows)
        run.inserted += inserted
        if (inserted) log(`groups: ${inserted} new (${posts.length} posts scraped)`)
      } catch (err) {
        run.errors += 1
        run.error_detail.push({ source: 'group', error: (err?.message ?? String(err)).slice(0, 500) })
        log(`group upsert ERROR: ${err?.message ?? err}`)
      }
    } catch (err) {
      run.errors += 1
      run.error_detail.push({ source: 'group', error: (err?.message ?? String(err)).slice(0, 500) })
      log(`group pass ERROR: ${err?.message ?? err}`)
    }
  }

  run.ok = !aborted
  const { error } = await supabase
    .from('deal_radar_runs')
    .insert({ ...run, finished_at: new Date().toISOString() })
  if (error) console.error('[deal-radar] failed to record run:', error.message)
  log(
    `done: ${run.searches} searches, ${run.hits} matched hits, ${run.inserted} new, ${run.errors} errors${aborted ? ' (ABORTED)' : ''}`,
  )
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[deal-radar] unexpected top-level failure:', err)
    process.exit(0)
  },
)
