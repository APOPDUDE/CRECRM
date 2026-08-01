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
