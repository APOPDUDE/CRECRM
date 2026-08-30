import assert from 'node:assert/strict'
import { looksLikeChallenge, parseRatePsf, parseSizeSf, toSpaceRow } from './parse.mjs'

// Sizes
assert.equal(parseSizeSf('2,637 SF'), 2637)
assert.equal(parseSizeSf('1,200-5,000 SF'), 1200)
assert.equal(parseSizeSf('On Request'), null)
assert.equal(parseSizeSf(null), null)

// Rates — captured live from 1575 Cattlemen Rd (2026-08-30)
assert.equal(parseRatePsf('$15.00 /SF/YR'), 15)
assert.equal(parseRatePsf('$8.00 /SF/YR'), 8)
assert.equal(parseRatePsf('$1.25 /SF/MO'), 15)
assert.equal(parseRatePsf('Upon Request'), null)
assert.equal(parseRatePsf('$4,500 Amt/MO'), null) // suite total, not a PSF rate
assert.equal(parseRatePsf(null), null)
// All display variants concatenated (CDP rendering) — the /SF/YR pair must win:
assert.equal(parseRatePsf('$15.00 /SF/YR $1.25 /SF/MO $39,555 /YR $3,296 /MO'), 15)
assert.equal(parseRatePsf('$8.00 /SF/YR $0.67 /SF/MO $24,640 /YR $2,053 /MO'), 8)

// Full row — the live Cattlemen fixture
const row = toSpaceRow({
  label: '1st Floor - G',
  size: '2,637 SF',
  term: 'Negotiable',
  rate: '$15.00 /SF/YR',
  use: 'Industrial',
  build_out: 'Partial Build-Out',
  available: 'Now',
})
assert.deepEqual(row, {
  label: '1st Floor - G',
  size_sf: 2637,
  rate_psf: 15,
  space_use: 'Industrial',
  build_out: 'Partial Build-Out',
  available: 'Now',
  term: 'Negotiable',
})
assert.equal(toSpaceRow({ label: '  ' }), null)

// Challenge detection
assert.equal(looksLikeChallenge('Pardon Our Interruption', ''), true)
assert.equal(looksLikeChallenge('', 'Powered and protected by  Privacy'), true)
assert.equal(
  looksLikeChallenge('1575 Cattlemen Rd', 'All Available Spaces(2) '.repeat(40)),
  false,
)

console.log('parse.test.mjs: all assertions passed')
