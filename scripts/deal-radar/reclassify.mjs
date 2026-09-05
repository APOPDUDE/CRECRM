/**
 * One-off maintenance: re-judge existing Marketplace deal_radar rows with the
 * CURRENT classifier and cross off (status -> declined) the ones that no longer
 * pass — the consumer-goods junk ("industrial barstool", "console table") that
 * landed before the classifier was tightened. Reversible: declined rows keep their
 * external_id (dedupe holds) and can be re-approved.
 *
 * Dry run by default. Add --apply to actually decline.
 *   node --env-file=.env reclassify.mjs           # preview
 *   node --env-file=.env reclassify.mjs --apply    # decline the junk
 *
 * Groups are skipped: their title is only the first post line, so re-judging by
 * title alone (without the body the ingest classifier saw) would over-reject.
 */
import { createClient } from '@supabase/supabase-js'
import { classify } from './normalize.mjs'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with `node --env-file=.env reclassify.mjs`')
  process.exit(1)
}
const APPLY = process.argv.includes('--apply')
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Working set only — never touch already-declined/converted rows. Marketplace only
// (source 'group' rows are judged on full post text at ingest, not the stored title).
const { data, error } = await supabase
  .from('deal_radar')
  .select('id, title, status, source, listing_type')
  .in('status', ['new', 'approved'])
  .neq('source', 'group')
  .limit(5000)
if (error) throw error

const junk = []
const keep = []
for (const r of data ?? []) {
  if (classify(r.title || '') === null) junk.push(r)
  else keep.push(r)
}

console.log(`working marketplace rows: ${data?.length ?? 0}`)
console.log(`  keep (still CRE): ${keep.length}`)
console.log(`  junk (reclassify -> null): ${junk.length}`)
console.log('\n--- sample JUNK (would be declined) ---')
for (const r of junk.slice(0, 50)) console.log(`  [${r.status}] ${r.title}`)
console.log('\n--- sample KEEP ---')
for (const r of keep.slice(0, 20)) console.log(`  [${r.listing_type}] ${r.title}`)

if (!APPLY) {
  console.log(`\nDRY RUN — re-run with --apply to decline the ${junk.length} junk rows.`)
  process.exit(0)
}

let done = 0
const ids = junk.map((r) => r.id)
for (let i = 0; i < ids.length; i += 200) {
  const chunk = ids.slice(i, i + 200)
  const { error: e } = await supabase.from('deal_radar').update({ status: 'declined' }).in('id', chunk)
  if (e) throw e
  done += chunk.length
}
console.log(`\nDeclined ${done} junk rows.`)
