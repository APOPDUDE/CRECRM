/**
 * Pure parsers for the LoopNet "All Available Spaces" grid text. Kept separate from
 * the worker so they can be tested without a browser (parse.test.mjs).
 */

/** '2,637 SF' -> 2637; '1,200-5,000 SF' -> 1200 (min); 'On Request' -> null */
export function parseSizeSf(s) {
  if (s == null) return null
  const str = String(s)
  if (/request/i.test(str)) return null
  const m = str.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/)
  if (!m) return null
  const n = Math.round(parseFloat(m[1]))
  return n > 0 && n < 5_000_000 ? n : null
}

/**
 * '$15.00 /SF/YR' -> 15; '$1.25 /SF/MO' -> 15 (annualized); 'Upon Request' -> null.
 * '$ Amt/MO' style totals (no /SF) -> null — a per-suite total without SF basis is
 * not a PSF rate and must not masquerade as one.
 *
 * ORDER MATTERS: depending on how the page rendered, the cell can carry ALL display
 * variants at once ('$15.00 /SF/YR $1.25 /SF/MO $39,555 /YR $3,296 /MO' — seen live
 * over CDP, 2026-08-30). Match the explicit /SF/YR pair first; a naive "has /MO
 * anywhere" test annualized 15 into 180.
 */
export function parseRatePsf(s) {
  if (s == null) return null
  const str = String(s).replace(/,/g, '')
  const yr = str.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*sf\s*\/\s*yr/i)
  if (yr) {
    const n = parseFloat(yr[1])
    return n > 0 && n < 1000 ? n : null
  }
  const mo = str.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*sf\s*\/\s*mo/i)
  if (mo) {
    const n = parseFloat(mo[1]) * 12
    return n > 0 && n < 1000 ? n : null
  }
  if (!/\/\s*sf/i.test(str)) return null
  const m = str.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/)
  if (!m) return null
  const n = parseFloat(m[1])
  return n > 0 && n < 1000 ? n : null
}

/** Raw grid row ({label,size,rate,...} strings) -> import_listing_spaces space object, or null. */
export function toSpaceRow(raw) {
  const label = raw?.label?.trim()
  if (!label) return null
  return {
    label: label.slice(0, 120),
    size_sf: parseSizeSf(raw.size),
    rate_psf: parseRatePsf(raw.rate),
    space_use: raw.use?.trim() || null,
    build_out: raw.build_out?.trim() || null,
    available: raw.available?.trim() || null,
    term: raw.term?.trim() || null,
  }
}

/** Text signals that we hit a bot wall rather than a listing page. */
export function looksLikeChallenge(title, bodyText) {
  const t = `${title || ''} ${bodyText || ''}`.slice(0, 1200)
  return (
    /pardon our interruption|verify you are a human|access denied|are you a robot/i.test(t) ||
    // The short interstitial shell: a near-empty page naming the protection vendor.
    ((bodyText || '').trim().length < 600 && /powered and protected by/i.test(t))
  )
}
