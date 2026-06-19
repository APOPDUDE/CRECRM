/**
 * Normalize a pasted LoopNet / Crexi listing URL down to the canonical, id-based
 * form the Apify scrapers resolve from. This strips marketing slugs, query
 * strings, and "recommId" recommendation params — the kind of decoration that
 * can otherwise point the scraper at the wrong listing.
 */
export type ListingUrlSource = 'loopnet' | 'crexi'

export interface NormalizedListingUrl {
  source: ListingUrlSource
  id: string
  /** Canonical URL to hand the scraper. */
  url: string
}

export function normalizeListingUrl(input: string): NormalizedListingUrl | null {
  const raw = (input || '').trim()
  if (!raw) return null
  let parsed: URL
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname

  if (host.includes('loopnet.')) {
    // /Listing/{slug?}/{id}/  — the id is the trailing numeric segment
    const m = path.match(/\/Listing\/(?:.*\/)?(\d{4,})/i)
    if (!m) return null
    return { source: 'loopnet', id: m[1], url: `https://www.loopnet.com/Listing/${m[1]}/` }
  }

  if (host.includes('crexi.')) {
    // /properties/{id}/...  or  /lease/properties/{id}/...  (shared id space)
    const m = path.match(/properties\/(\d{4,})/i)
    if (!m) return null
    return { source: 'crexi', id: m[1], url: `https://www.crexi.com/properties/${m[1]}` }
  }

  return null
}
