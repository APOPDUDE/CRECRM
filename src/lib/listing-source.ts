// Where a property listing came from. Distinct from lead_source: this is the marketplace
// a property was scraped or entered from, shown on the tenant board so a Crexi listing
// reads "Crexi".
export type ListingSource = 'crexi' | 'loopnet' | 'manual'

/** Derive a property's listing source from its dedupe key, URL, then source col. */
export function listingSourceOf(p: {
  source_key?: string | null
  listing_url?: string | null
  source?: string | null
}): ListingSource | null {
  const key = p.source_key ?? ''
  if (key.startsWith('crexi:')) return 'crexi'
  if (key.startsWith('loopnet:')) return 'loopnet'
  const url = p.listing_url ?? ''
  if (/crexi\.com/i.test(url)) return 'crexi'
  if (/loopnet\.com/i.test(url)) return 'loopnet'
  if (p.source === 'manual') return 'manual'
  return null
}
