/**
 * Self-check for the parsing/classification gate — the branches a live run
 * rarely enters are exactly the ones that rot (see the bulk-import lesson).
 * Run: npm test (plain node, no framework).
 */
import assert from 'node:assert/strict'
import {
  classify,
  extractListings,
  isDocIdBreak,
  normalizeGroupPost,
  normalizeListing,
  parsePrice,
  parseSize,
} from './normalize.mjs'
import { groupIdFromUrl } from './group-watch.mjs'

// ---- price ----
assert.equal(parsePrice('$25,000'), 25000)
assert.equal(parsePrice(1500), 1500)
assert.equal(parsePrice({ formatted_amount: '$1,500 / Month' }), 1500)
assert.equal(parsePrice('Free'), null)
assert.equal(parsePrice(null), null)
assert.equal(parsePrice('$0'), null)

// ---- size ----
assert.deepEqual(parseSize('5,000 sqft warehouse on 2.5 acres'), { sqft: 5000, acres: 2.5 })
assert.deepEqual(parseSize('10000 SF flex'), { sqft: 10000, acres: null })
assert.deepEqual(parseSize('1.25 ac vacant lot'), { sqft: null, acres: 1.25 })
assert.deepEqual(parseSize('nice property'), { sqft: null, acres: null })
// implausible numbers rejected
assert.equal(parseSize('12 sq ft cage').sqft, null)

// ---- classify: the junk gate ----
assert.equal(classify('Warehouse shelving racks for sale'), null)
assert.equal(classify('Warehouse job hiring forklift operator'), null)
assert.equal(classify('20ft shipping container storage'), null)
assert.equal(classify('Landscaping trailer and equipment'), null)
assert.equal(classify('LEGO warehouse playset lot'), null)
// real hits
assert.equal(classify('5,000 SF warehouse for lease with loading dock'), 'industrial')
assert.equal(classify('Truck parking yard space available'), 'industrial')
assert.equal(classify('2.5 acres vacant land for sale, zoned commercial'), 'land')
assert.equal(classify('Vacant lot for sale'), 'land')
// building noun beats a land read
assert.equal(classify('Warehouse on 3 acres'), 'industrial')
// bare "industrial" adjective ranks below land: this is LAND
assert.equal(classify('Vacant industrial land, 3.2 acres in Plant City'), 'land')
// bare "industrial" with no land signal is still industrial
assert.equal(classify('Industrial building for lease, zoned M-1'), 'industrial')
// neither
assert.equal(classify('2015 Toyota Camry'), null)

// ---- normalizeListing ----
const ctx = { market: 'Tampa', keyword: 'warehouse' }
const row = normalizeListing(
  {
    id: '123456789',
    marketplace_listing_title: 'Flex space 3,200 sqft with roll-up door',
    price: '$4,500',
    location: { city: 'Tampa', state: 'FL' },
    creation_time: 1756400000,
    photo: { uri: 'https://scontent.example/img.jpg' },
  },
  ctx,
)
assert.equal(row.external_id, '123456789')
assert.equal(row.listing_type, 'industrial')
assert.equal(row.price, 4500)
assert.equal(row.size_sqft, 3200)
assert.equal(row.location_text, 'Tampa, FL')
assert.equal(row.listing_url, 'https://www.facebook.com/marketplace/item/123456789/')
assert.equal(row.thumbnail_url, 'https://scontent.example/img.jpg')
assert.ok(row.posted_at?.startsWith('2025') || row.posted_at?.startsWith('2026'))
assert.equal(row.market, 'Tampa')

// junk/incomplete rows fall out as null, never throw
assert.equal(normalizeListing({ id: '1', title: 'Pallet racking' }, ctx), null)
assert.equal(normalizeListing({ title: 'no id industrial land' }, ctx), null)
assert.equal(normalizeListing(null, ctx), null)
assert.equal(normalizeListing('garbage', ctx), null)

// ---- extractListings shapes ----
assert.equal(extractListings([{ id: 1 }]).length, 1)
assert.equal(extractListings({ listings: [{ id: 1 }, { id: 2 }] }).length, 2)
assert.equal(extractListings({ results: [] }).length, 0)
assert.equal(extractListings({ edges: [{ node: { id: 1 } }] })[0].id, 1)
assert.equal(extractListings({ message: 'no array here' }).length, 0)
assert.equal(extractListings('text').length, 0)

// ---- group posts ----
assert.equal(groupIdFromUrl('https://www.facebook.com/groups/274714022370896'), '274714022370896')
assert.equal(
  groupIdFromUrl('https://www.facebook.com/groups/commercialrealestateinflorida'),
  'commercialrealestateinflorida',
)
assert.equal(groupIdFromUrl('https://www.facebook.com/groups/123/posts/456/'), '123')

const grp = { id: '999', name: 'FL CRE', market: 'Florida (group)' }
const gpost = normalizeGroupPost(
  {
    id: '77',
    text: 'FOR SALE: 3.2 acres of vacant industrial land in Plant City. $450,000. DM me.',
    author: 'Jane Broker',
  },
  grp,
)
assert.equal(gpost.external_id, 'group:999:77')
assert.equal(gpost.listing_type, 'land')
assert.equal(gpost.source, 'group')
assert.equal(gpost.price, 450000)
assert.equal(gpost.size_acres, 3.2)
assert.equal(gpost.market, 'Plant City') // detected from body, overriding group default
assert.equal(gpost.group_id, '999')
assert.equal(gpost.author_name, 'Jane Broker')
assert.ok(gpost.listing_url.includes('/groups/999/posts/77'))

// warehouse post with $1.2M shorthand, market falls back to group default
const gpost2 = normalizeGroupPost(
  { id: '88', text: 'Leasing a 12,000 sqft warehouse with dock doors. $1.2M build-out ready.' },
  grp,
)
assert.equal(gpost2.listing_type, 'industrial')
assert.equal(gpost2.price, 1200000)
assert.equal(gpost2.size_sqft, 12000)
assert.equal(gpost2.market, 'Florida (group)')

// junk + incomplete group posts drop out, never throw
assert.equal(normalizeGroupPost({ id: '1', text: 'Selling office furniture and shelving' }, grp), null)
assert.equal(normalizeGroupPost({ id: '2', text: 'short' }, grp), null)
assert.equal(normalizeGroupPost({ text: 'no id here, warehouse land' }, grp), null)
assert.equal(normalizeGroupPost(null, grp), null)

// ---- doc_id break detection ----
assert.ok(isDocIdBreak('GraphQL doc_id 1234 rejected'))
assert.ok(isDocIdBreak('Unexpected token < in JSON'))
assert.ok(isDocIdBreak('run capture-queries to refresh'))
assert.ok(!isDocIdBreak('ECONNRESET'))

console.log('normalize.test.mjs: all assertions passed')
