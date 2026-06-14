// Client-side geocoding via OpenStreetMap Nominatim (free; the browser's Referer
// satisfies its usage policy). Used to place manually-entered properties on the
// Deal Map and the property mini-maps — scraped properties already carry
// coordinates from Apify.

// Session-scoped cache so a given address is geocoded at most once — keeps us well
// under Nominatim's ~1 req/s policy even when many mini-maps render the same
// address across navigations. Successful and "not found" results are cached;
// transient network errors are not (so they can retry).
const geocodeCache = new Map<string, { lat: number; lng: number } | null>()

export async function geocodeAddress(parts: {
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}): Promise<{ lat: number; lng: number } | null> {
  const q = [parts.address, parts.city, parts.state, parts.zip].filter(Boolean).join(', ')
  if (!q.trim()) return null
  if (geocodeCache.has(q)) return geocodeCache.get(q)!
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    let result: { lat: number; lng: number } | null = null
    if (res.ok) {
      const data = (await res.json()) as Array<{ lat: string; lon: string }>
      if (data.length) {
        const lat = Number(data[0].lat)
        const lng = Number(data[0].lon)
        if (Number.isFinite(lat) && Number.isFinite(lng)) result = { lat, lng }
      }
    }
    geocodeCache.set(q, result)
    return result
  } catch {
    return null
  }
}
