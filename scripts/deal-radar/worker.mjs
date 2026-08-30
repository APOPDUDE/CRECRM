/**
 * Deal Radar ingestion worker.
 *
 * Runs on the Mac (launchd, see com.crecrm.dealradar.plist), where Chrome is
 * logged into Facebook — the facebook-marketplace-mcp server replays that
 * session's cookies. Loops MARKETS × KEYWORDS through the MCP's
 * `search_listings`, normalizes/classifies hits, and inserts only NEW
 * industrial/land rows into deal_radar (dedupe on external_id).
 *
 * Design rules (do not soften):
 * - ≥21s between MCP calls — the server self-limits to 3 req/min; we pace
 *   ourselves too so a server update can't turn us into a hammer.
 * - Never crash: every search is try/caught, every failure is counted and
 *   logged, and a run row lands in deal_radar_runs even on abort.
 * - 3 consecutive failures = probably a rotated doc_id or a dead FB session.
 *   Alert once (ALERT_WEBHOOK_URL, optional) and stop the cycle — the next
 *   scheduled run retries; hammering a broken endpoint helps nobody.
 * - This worker READS Marketplace only. It never messages anyone.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createClient } from '@supabase/supabase-js'
import { extractListings, isDocIdBreak, normalizeGroupPost, normalizeListing } from './normalize.mjs'
import { groupIdFromUrl, watchGroups } from './group-watch.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const config = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'))

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  FB_MCP_PATH,
  CHROME_PROFILE = 'Default',
  ALERT_WEBHOOK_URL,
} = process.env

for (const [name, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FB_MCP_PATH })) {
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
let lastCallAt = 0
async function pace() {
  const gap = PACE_MIN_MS + Math.floor(Math.random() * Math.max(0, PACE_MAX_MS - PACE_MIN_MS))
  const wait = lastCallAt + gap - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCallAt = Date.now()
}

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

/** Call one MCP tool, returning parsed JSON payload or throwing with a useful message. */
async function callSearch(client, args) {
  await pace()
  const res = await client.callTool({ name: 'search_listings', arguments: args }, undefined, { timeout: 120_000 }) // 60s SDK default is too tight for first-search session init + high-volume terms
  const text = (res?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
  if (res?.isError) throw new Error(`MCP error: ${text.slice(0, 500)}`)
  try {
    return JSON.parse(text)
  } catch {
    // Some builds return prose around JSON; salvage the first {...} or [...]
    const m = text.match(/[[{][\s\S]*[\]}]/)
    if (m) {
      try {
        return JSON.parse(m[0])
      } catch {
        /* fall through */
      }
    }
    throw new Error(`unparseable search result (doc_id rotation?): ${text.slice(0, 300)}`)
  }
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

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [FB_MCP_PATH],
    env: { ...process.env, CHROME_PROFILE },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'deal-radar-worker', version: '1.0.0' })

  try {
    await client.connect(transport)
    log(`connected to MCP (${FB_MCP_PATH})`)

    let consecutiveFailures = 0

    outer: for (const market of config.markets) {
      for (const keyword of config.keywords) {
        run.searches += 1
        try {
          const payload = await callSearch(client, {
            query: keyword,
            latitude: market.lat,
            longitude: market.lng,
            radius_km: Math.round(market.radius_miles * 1.609),
            min_price: config.min_price ?? undefined,
            limit: config.limit_per_search ?? 20,
          })
          const raw = extractListings(payload)
          const rows = raw
            .map((item) => normalizeListing(item, { market: market.name, keyword }))
            .filter(Boolean)
          run.hits += rows.length
          consecutiveFailures = 0

          if (rows.length > 0) {
            // Dedupe within the batch (the same listing matches several keywords)
            const seen = new Set()
            const unique = rows.filter((r) => !seen.has(r.external_id) && seen.add(r.external_id))
            const { data, error } = await supabase
              .from('deal_radar')
              .upsert(unique, { onConflict: 'external_id', ignoreDuplicates: true })
              .select('external_id')
            if (error) throw new Error(`supabase insert: ${error.message}`)
            run.inserted += data?.length ?? 0
            if (data?.length) log(`${market.name} × "${keyword}": ${data.length} new (${raw.length} raw)`)
          }
        } catch (err) {
          run.errors += 1
          consecutiveFailures += 1
          const msg = err?.message ?? String(err)
          run.error_detail.push({ market: market.name, keyword, error: msg.slice(0, 500) })
          log(`ERROR ${market.name} × "${keyword}": ${msg}`)
          if (consecutiveFailures >= (config.abort_after_consecutive_failures ?? 3)) {
            const kind = isDocIdBreak(msg)
              ? 'Facebook likely rotated GraphQL doc_ids — run `npm run capture-queries` in the MCP repo, or check the Chrome FB session.'
              : 'repeated failures — check the worker log.'
            await alert(`deal-radar aborted after ${consecutiveFailures} consecutive failures. ${kind} Last: ${msg.slice(0, 300)}`)
            aborted = true
            break outer
          }
        }
      }
    }

    // Group pass — a separate reader (Playwright), independent of the MCP. A
    // group failure never aborts the Marketplace results already banked.
    const groups = (config.groups ?? []).map((g) => ({
      id: groupIdFromUrl(g.url),
      name: g.name,
      market: g.market,
    }))
    if (!aborted && groups.length > 0) {
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
        const groupRows = posts
          .map(({ post, group }) => normalizeGroupPost(post, group))
          .filter(Boolean)
        run.hits += groupRows.length
        if (groupRows.length > 0) {
          const seen = new Set()
          const unique = groupRows.filter((r) => !seen.has(r.external_id) && seen.add(r.external_id))
          const { data, error } = await supabase
            .from('deal_radar')
            .upsert(unique, { onConflict: 'external_id', ignoreDuplicates: true })
            .select('external_id')
          if (error) throw new Error(`supabase group insert: ${error.message}`)
          run.inserted += data?.length ?? 0
          if (data?.length) log(`groups: ${data.length} new (${posts.length} posts scraped)`)
        }
      } catch (err) {
        run.errors += 1
        run.error_detail.push({ source: 'group', error: (err?.message ?? String(err)).slice(0, 500) })
        log(`group pass ERROR: ${err?.message ?? err}`)
      }
    }
  } catch (err) {
    // Connect-level failure (MCP not installed, Chrome cookies unreadable…)
    run.errors += 1
    run.error_detail.push({ error: `fatal: ${err?.message ?? err}`.slice(0, 500) })
    await alert(`deal-radar could not start a cycle: ${err?.message ?? err}`)
    aborted = true
  } finally {
    try {
      await client.close()
    } catch {
      /* already dead is fine */
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
}

main().then(
  () => process.exit(0),
  (err) => {
    // Belt and braces — main() shouldn't reject, but never leave launchd a crash loop.
    console.error('[deal-radar] unexpected top-level failure:', err)
    process.exit(0)
  },
)
