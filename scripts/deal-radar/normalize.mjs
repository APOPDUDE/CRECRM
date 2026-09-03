/**
 * Pure normalization + classification for Facebook Marketplace hits.
 *
 * Everything here is defensive: the MCP replays FB's private GraphQL, so field
 * names drift between deploys. Pick fields by candidate list, never assume a
 * shape, and let a row that can't produce an id + title fall out as null
 * rather than throw — worker.mjs counts those, it must never crash on them.
 */

const pick = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return null
}

/** "$25,000", "25000", {amount: "25000"}, {formatted_amount: "$1,500 / Month"} → number|null */
export function parsePrice(raw) {
  if (raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'object') {
    return parsePrice(pick(raw, ['amount', 'formatted_amount', 'price', 'text']))
  }
  const m = String(raw).replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Pull square footage and acreage out of freeform title/description text. */
export function parseSize(text) {
  const t = String(text || '')
  let sqft = null
  let acres = null
  const sq = t.match(/([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*\.?\s*ft|sqft|sf\b|square\s+f[oe]*t)/i)
  if (sq) {
    const n = Math.round(Number(sq[1].replace(/,/g, '')))
    if (Number.isFinite(n) && n >= 100 && n < 10_000_000) sqft = n
  }
  const ac = t.match(/([\d,]+(?:\.\d+)?)\s*(?:acres?\b|ac\b)/i)
  if (ac) {
    const n = Number(ac[1].replace(/,/g, ''))
    if (Number.isFinite(n) && n > 0 && n < 100_000) acres = n
  }
  return { sqft, acres }
}

// Order matters: junk knocks a hit out before type terms can claim it.
// FB searches for "warehouse" return shelving, jobs and toys; "land" returns
// board games and phone plans. These lists are the whole quality gate.
const JUNK = [
  /shelv|rack|pallet|forklift|conveyor/i,
  /\bjob\b|hiring|position|apply now/i,
  /\btoy\b|\blego\b|playset|costume/i,
  /shipping container|conex|storage unit\b|\bshed\b|carport/i,
  /mobile home|\brv\b\s*(?:lot|site)?\s*(?:for rent)?$/i,
  /\bboat\b|\bjet ?ski\b|\batv\b|golf cart/i,
  /land\s*scap/i, // landscaping services/equipment
  /\blandline\b|\blander\b/i,
  /timeshare|vacation rental/i,
  // "industrial-style" home goods & furniture that ride the CRE searches — the
  // "industrial barstool" problem. Consumer terms that never head a real listing.
  /bar\s?stool|\bstool\b|\bfurniture\b|\bdecor\b|\bchair\b|\bsofa\b|\bcouch\b|\bdesk\b|dresser|nightstand|mattress|\brug\b|curtain|\blamp\b|chandelier|sconce|ottoman|headboard/i,
  /\bsink\b|\bfaucet\b|\bvase\b|\bplanter\b|\bmirror\b|dining\s+set|bed\s+frame/i,
]

const LAND = [
  /\bacre|\bacreage\b/i,
  /vacant\s+(?:land|lot|parcel)/i,
  /\bland\s+(?:for\s+sale|available|lease)/i,
  /\blot\s+(?:for\s+sale|available)/i,
  /\bparcel\b/i,
  /buildable|zoned\s+\w+\s*land/i,
]

// A physical building/yard — these WIN over a land read ("warehouse on 3 acres"
// is a warehouse). Kept separate from the weak "industrial" adjective, which
// must NOT beat a land read ("vacant industrial land" is land).
const INDUSTRIAL_STRONG = [
  /warehouse/i,
  /\bflex\s*(?:space|building|unit)?\b/i,
  /distribution|logistics/i,
  /truck\s*(?:parking|yard|terminal)/i,
  /outdoor\s+storage|\bios\s+(?:site|yard|lot)\b/i,
  /\bshop\s*(?:space|building|bay)|work\s*shop\s*(?:space|bay)/i,
  /\bhangar\b/i,
  /contractor'?s?\s+yard|laydown\s+yard|equipment\s+yard/i,
  /loading\s+dock|roll[- ]?up\s+door|grade[- ]?level/i,
]

// "industrial" on its own is usually a zoning adjective, so it ranks BELOW land.
// But bare /industrial/i also matched "industrial barstool" / "industrial chic
// decor". Require it to sit next to a CRE noun, or the listing to state a
// lease/sale/size, so consumer goods with the "industrial" style tag drop out.
const INDUSTRIAL_WEAK = [
  /\bindustrial\s+(?:building|unit|space|park|property|lot|land|zoned|zoning|condo|complex|bay|suite|warehouse|yard|flex|acreage)\b/i,
  /\bindustrial\b.*\b(?:for\s+(?:lease|rent|sale)|\d[\d,.]*\s*(?:sf|sq\.?\s*ft|acres?))\b/i,
]

/**
 * industrial | land | null (null = don't persist). Precedence:
 * 1. a building/yard noun -> industrial (beats a land read)
 * 2. a land signal -> land ("vacant industrial land" lands here)
 * 3. bare "industrial" adjective with no land signal -> industrial
 */
export function classify(text) {
  const t = String(text || '')
  if (JUNK.some((re) => re.test(t))) return null
  if (INDUSTRIAL_STRONG.some((re) => re.test(t))) return 'industrial'
  if (LAND.some((re) => re.test(t))) return 'land'
  if (INDUSTRIAL_WEAK.some((re) => re.test(t))) return 'industrial'
  return null
}

/**
 * One raw MCP hit → a deal_radar Insert row, or null when it's junk / not
 * industrial-or-land / missing an identity. `market` and `keyword` name the
 * search that surfaced it.
 */
export function normalizeListing(item, { market, keyword }) {
  if (!item || typeof item !== 'object') return null
  const externalId = pick(item, ['id', 'listing_id', 'listingId', 'external_id'])
  const title = pick(item, ['title', 'marketplace_listing_title', 'name'])
  if (!externalId || !title) return null

  const description = pick(item, ['description', 'redacted_description', 'body']) || ''
  const haystack = `${title}\n${description}\n${pick(item, ['category', 'category_name']) || ''}`
  const listingType = classify(haystack)
  if (!listingType) return null

  const { sqft, acres } = parseSize(haystack)
  const location = pick(item, ['location', 'location_text', 'city'])
  const locationText =
    typeof location === 'object'
      ? [pick(location, ['city', 'name']), pick(location, ['state'])].filter(Boolean).join(', ') || null
      : location

  const postedRaw = pick(item, ['creation_time', 'created_at', 'posted_at', 'listing_date'])
  let postedAt = null
  if (postedRaw != null) {
    const d = typeof postedRaw === 'number' ? new Date(postedRaw * (postedRaw < 1e12 ? 1000 : 1)) : new Date(postedRaw)
    if (!Number.isNaN(d.getTime())) postedAt = d.toISOString()
  }

  const photo = pick(item, ['thumbnail_url', 'photo', 'primary_photo', 'image', 'photo_url'])
  const thumbnailUrl =
    typeof photo === 'object' ? pick(photo, ['uri', 'url', 'src']) : photo

  return {
    external_id: String(externalId),
    title: String(title).slice(0, 500),
    price: parsePrice(pick(item, ['price', 'listing_price', 'formatted_price'])),
    location_text: locationText ? String(locationText).slice(0, 200) : null,
    lat: typeof item.latitude === 'number' ? item.latitude : (typeof item.lat === 'number' ? item.lat : null),
    lng: typeof item.longitude === 'number' ? item.longitude : (typeof item.lng === 'number' ? item.lng : null),
    size_sqft: sqft,
    size_acres: acres,
    category: pick(item, ['category', 'category_name']),
    listing_type: listingType,
    listing_url: pick(item, ['url', 'listing_url']) || `https://www.facebook.com/marketplace/item/${externalId}/`,
    thumbnail_url: thumbnailUrl ? String(thumbnailUrl) : null,
    posted_at: postedAt,
    market,
    keyword,
    raw_json: item,
  }
}

// A group post is freeform text, so lean on the same market keywords to guess
// which metro it's about; fall back to the group's own default market label.
const MARKET_HINTS = [
  [/\btampa\b|\bybor\b/i, 'Tampa'],
  [/\bst\.?\s*pete|petersburg|clearwater|pinellas|largo|dunedin/i, 'Pinellas (St. Pete-Clearwater)'],
  [/\bplant city\b/i, 'Plant City'],
  [/\blakeland\b|polk county|winter haven|bartow/i, 'Lakeland'],
  [/\borlando\b|orange county|kissimmee|sanford|winter park/i, 'Orlando'],
  [/\bsarasota\b|bradenton|manatee|venice|lakewood ranch/i, 'Sarasota-Bradenton'],
]

function guessMarket(text, fallback) {
  for (const [re, name] of MARKET_HINTS) if (re.test(text)) return name
  return fallback
}

/**
 * One scraped Facebook group post → a deal_radar Insert row, or null when it's
 * junk / not industrial-or-land / missing an id. Reuses the same parse + junk +
 * classify gate as Marketplace, so the two sources dedupe and read identically.
 *
 * `post` shape (from group-watch.mjs): { id, text, permalink, author, image_url,
 * created_ms }. `group` = { id, name, market } from config.
 */
export function normalizeGroupPost(post, group) {
  if (!post || typeof post !== 'object') return null
  const postId = post.id || post.post_id
  const text = String(post.text || '').trim()
  if (!postId || !text) return null

  const listingType = classify(text)
  if (!listingType) return null

  const { sqft, acres } = parseSize(text)
  // Grab the first price-looking token from the body ("$25,000", "$1.2M").
  const priceMatch = text.match(/\$\s?[\d,]+(?:\.\d+)?\s?[kKmM]?/)
  let price = null
  if (priceMatch) {
    const s = priceMatch[0].replace(/[$,\s]/g, '')
    const mult = /m$/i.test(s) ? 1e6 : /k$/i.test(s) ? 1e3 : 1
    const n = Number(s.replace(/[kKmM]$/, '')) * mult
    if (Number.isFinite(n) && n >= 1000) price = n
  }

  // Title = the first sentence/line, so the card reads like a listing.
  const title = (text.split(/\n|(?<=[.!?])\s/)[0] || text).slice(0, 200)

  return {
    external_id: `group:${group.id}:${postId}`,
    title,
    price,
    location_text: null,
    lat: null,
    lng: null,
    size_sqft: sqft,
    size_acres: acres,
    category: null,
    listing_type: listingType,
    listing_url: post.permalink || `https://www.facebook.com/groups/${group.id}/posts/${postId}/`,
    thumbnail_url: post.image_url || null,
    posted_at: post.created_ms ? new Date(post.created_ms).toISOString() : null,
    market: guessMarket(text, group.market || 'Florida (group)'),
    keyword: null,
    source: 'group',
    group_id: String(group.id),
    group_name: group.name || null,
    author_name: post.author || null,
    raw_json: post,
  }
}

/**
 * The MCP wraps results differently across versions ({listings}, {results},
 * bare array, or JSON inside content text). Find the first array of objects.
 */
export function extractListings(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    for (const key of ['listings', 'results', 'items', 'data', 'edges']) {
      const v = payload[key]
      if (Array.isArray(v)) return v.map((e) => e?.node ?? e)
    }
    for (const v of Object.values(payload)) {
      if (Array.isArray(v) && v.every((e) => e && typeof e === 'object')) return v
    }
  }
  return []
}

/** Does an error smell like FB rotated a GraphQL doc_id (vs a transient blip)? */
export function isDocIdBreak(message) {
  return /doc_?id|graphql|unexpected token|not valid json|query.*(?:invalid|expired)|capture-queries/i.test(
    String(message || ''),
  )
}
