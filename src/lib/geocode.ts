// Client-side geocoding via OpenStreetMap Nominatim (free; the browser's Referer
// satisfies its usage policy). Used to place manually-entered properties on the
// Deal Map — scraped properties already carry coordinates from Apify.
export async function geocodeAddress(parts: {
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}): Promise<{ lat: number; lng: number } | null> {
  const q = [parts.address, parts.city, parts.state, parts.zip].filter(Boolean).join(', ')
  if (!q.trim()) return null
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const data = (await res.json()) as Array<{ lat: string; lon: string }>
    if (!data.length) return null
    const lat = Number(data[0].lat)
    const lng = Number(data[0].lon)
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
  } catch {
    return null
  }
}
