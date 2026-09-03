import { useQuery } from '@tanstack/react-query'
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { CITY_LIMITS_URL, COUNTY_LINES_URL } from '@/lib/map-layers'

/** TIGERweb's GeoJSON: NAME is "Hillsborough County" / "Tampa city" / "Belleair town". */
export type BoundaryProps = { NAME: string; GEOID: string }
export type BoundaryFC = FeatureCollection<Polygon | MultiPolygon, BoundaryProps>

async function fetchBoundaries(url: string): Promise<BoundaryFC> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`TIGERweb ${res.status}`)
  const fc = (await res.json()) as BoundaryFC & { error?: { message?: string } }
  // ArcGIS answers a bad query with HTTP 200 and an error body
  if (fc.error) throw new Error(fc.error.message ?? 'TIGERweb error')
  return fc
}

const opts = {
  staleTime: Infinity,
  gcTime: 60 * 60_000,
  refetchOnWindowFocus: false,
  retry: 1,
} as const

/** Florida's county boundaries, fetched once per session. */
export function useCountyLines(enabled: boolean) {
  return useQuery({ queryKey: ['reference-layer', 'counties'], enabled, ...opts, queryFn: () => fetchBoundaries(COUNTY_LINES_URL) })
}

/** Incorporated city limits touching the six-county book, fetched once per session. */
export function useCityLimits(enabled: boolean) {
  return useQuery({ queryKey: ['reference-layer', 'cities'], enabled, ...opts, queryFn: () => fetchBoundaries(CITY_LIMITS_URL) })
}

/** "Tampa city" → "Tampa", "Hillsborough County" → "Hillsborough" — the label the map shows. */
export function boundaryName(props: BoundaryProps): string {
  return props.NAME.replace(/\s+(city|town|village|County|CDP)$/i, '')
}
