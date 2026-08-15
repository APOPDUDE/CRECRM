import { useQuery } from '@tanstack/react-query'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import {
  OVERLAY_LOWLANDS_URL,
  OVERLAY_ZONING_URL,
  overlayBucket,
  overlayKey,
  type OverlayType,
  type ZoningFeatureProps,
} from '@/lib/overlays'

export type ZoningFeature = Feature<Polygon | MultiPolygon, ZoningFeatureProps>
export type ZoningFC = FeatureCollection<Polygon | MultiPolygon, ZoningFeatureProps>

async function fetchFc<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`overlay fetch failed: ${res.status}`)
  return (await res.json()) as T
}

/**
 * The zoning-districts overlay (2.6 MB, 285 dissolved districts). Fetched once per
 * session and held forever — the artifact is immutable (versioned filename), so there
 * is nothing to go stale. `enabled` gates the fetch on intent (a layer toggled on or
 * the code picker opened): first paint of the map never waits on this.
 */
export function useZoningOverlay(enabled: boolean) {
  return useQuery({
    queryKey: ['overlay', 'zoning', OVERLAY_ZONING_URL],
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: () => fetchFc<ZoningFC>(OVERLAY_ZONING_URL),
  })
}

/** The lowlands overlay (7.5 MB of wet ground). Same lifecycle as zoning. */
export function useLowlandsOverlay(enabled: boolean) {
  return useQuery({
    queryKey: ['overlay', 'lowlands', OVERLAY_LOWLANDS_URL],
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: () => fetchFc<FeatureCollection>(OVERLAY_LOWLANDS_URL),
  })
}

export type OverlayCodeEntry = {
  key: string
  code: string
  jurisdiction: string
  description: string
  bucket: OverlayType
}

/** The code picker's rows, straight from the overlay's own features — the shapes and
 * the checklist can never disagree about which districts exist. */
export function overlayCodeEntries(fc: ZoningFC | undefined): OverlayCodeEntry[] {
  if (!fc) return []
  const out: OverlayCodeEntry[] = []
  for (const f of fc.features) {
    const bucket = overlayBucket(f.properties)
    if (!bucket) continue
    out.push({
      key: overlayKey(f.properties.j, f.properties.c),
      code: f.properties.c,
      jurisdiction: f.properties.j,
      description: f.properties.d,
      bucket,
    })
  }
  return out.sort((a, b) => a.code.localeCompare(b.code) || a.jurisdiction.localeCompare(b.jurisdiction))
}
