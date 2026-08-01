/** Great-circle distance helpers for radius search on the deal map. */

const EARTH_RADIUS_MI = 3958.7613

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Haversine distance in miles between two lat/lng points. */
export function distanceMiles(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h))
}

export type RadiusFilter = { lat: number; lng: number; miles: number }

export type LatLng = { lat: number; lng: number }

/**
 * Ray-casting point-in-polygon with a bounding-box pre-check. Vertices are in draw order;
 * the closing edge (last -> first) is implicit. Fine at Tampa Bay scale where lat/lng is
 * close enough to planar — nobody draws a search area spanning a meridian.
 */
export function pointInPolygon(
  poly: LatLng[],
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  if (poly.length < 3) return false
  if (typeof lat !== 'number' || typeof lng !== 'number') return false
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const v of poly) {
    if (v.lat < minLat) minLat = v.lat
    if (v.lat > maxLat) maxLat = v.lat
    if (v.lng < minLng) minLng = v.lng
    if (v.lng > maxLng) maxLng = v.lng
  }
  if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) return false

  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].lat, xi = poly[i].lng
    const yj = poly[j].lat, xj = poly[j].lng
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Cheap bounding-box pre-check before the trig — at 10k+ properties the box rejects
 * almost everything for the cost of four comparisons.
 */
export function withinRadius(
  r: RadiusFilter,
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  const dLat = r.miles / 69
  if (Math.abs(lat - r.lat) > dLat) return false
  // a degree of longitude shrinks with latitude; guard the pole/cos(0) case
  const milesPerLngDeg = Math.max(Math.cos(toRad(r.lat)) * 69, 0.0001)
  if (Math.abs(lng - r.lng) > r.miles / milesPerLngDeg) return false
  return distanceMiles(r.lat, r.lng, lat, lng) <= r.miles
}
