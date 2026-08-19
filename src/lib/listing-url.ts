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

/**
 * The listing identity carried by a property's `source_key` ('loopnet:<id>' /
 * 'crexi:<id>'). Returns null for every non-listing key — 'parcel:…', 'addr:…',
 * a bare parcel string, or no key at all.
 */
export function listingIdFromSourceKey(
  sourceKey: string | null | undefined,
): { source: ListingUrlSource; id: string } | null {
  const m = (sourceKey ?? '').trim().match(/^(loopnet|crexi):(\d+)$/i)
  if (!m) return null
  return { source: m[1].toLowerCase() as ListingUrlSource, id: m[2] }
}

const slugify = (s: string | null | undefined) =>
  (s ?? '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * The ONE way a property's listing link is built (crossed-URL bug, 2026-08-18):
 * derive it from that property's OWN `source_key`, never from a scraped URL field —
 * scraped comp URLs have been observed carrying a neighboring listing's id.
 * Non-listing keys (parcel:/addr:/bare parcel/null) get no link.
 */
export function listingUrlFromSourceKey(
  sourceKey: string | null | undefined,
  address?: string | null,
  city?: string | null,
): string | null {
  const key = listingIdFromSourceKey(sourceKey)
  if (!key) return null
  if (key.source === 'crexi') return `https://www.crexi.com/properties/${key.id}`
  // LoopNet routes by the trailing id; the slug is cosmetic but matches the site's form.
  const slug = slugify([address, city, 'FL'].filter(Boolean).join(' '))
  return slugify(address ?? '')
    ? `https://www.loopnet.com/Listing/${slug}/${key.id}/`
    : `https://www.loopnet.com/Listing/${key.id}/`
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
