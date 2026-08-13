import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { PropertyWithCounts } from '@/hooks/use-properties'
import type { OwnerContext } from '@/hooks/use-owners'

/** The camera, in the only terms the database cares about. */
export type MapViewport = { south: number; west: number; north: number; east: number }

/**
 * How many pins one request may carry.
 *
 * 1000 is PostgREST's own ceiling — ask for more and it silently returns 1000 anyway, so
 * the number here matches what can actually arrive rather than pretending otherwise. It
 * still clears the map's marker cap (800 on desktop) with room to spare, and the RPC
 * reports the true count in the box so a crowded viewport says "800 of 1,860" instead of
 * implying that what arrived is everything.
 */
export const MAP_VIEWPORT_LIMIT = 1000

/**
 * Snap the camera outward to a ~2km grid, with a quarter-viewport of margin.
 *
 * Two things fall out of this. The margin means a small pan lands on pins that are
 * already loaded, so markers appear the moment the drag stops rather than after a round
 * trip. The snapping means nudging the map a block over produces the SAME box — the same
 * query key — so React Query serves it from cache instead of asking again. Only a real
 * move to somewhere new costs a request.
 */
const GRID = 0.02
const MARGIN = 0.25

function snapBox(v: MapViewport): MapViewport {
  const padLat = (v.north - v.south) * MARGIN
  const padLng = (v.east - v.west) * MARGIN
  // Rounded to 4dp as well as snapped: floating-point noise in the key would defeat the
  // cache hit the snapping exists to produce.
  const down = (x: number) => Number((Math.floor(x / GRID) * GRID).toFixed(4))
  const up = (x: number) => Number((Math.ceil(x / GRID) * GRID).toFixed(4))
  return {
    south: Math.max(-90, down(v.south - padLat)),
    west: Math.max(-180, down(v.west - padLng)),
    north: Math.min(90, up(v.north + padLat)),
    east: Math.min(180, up(v.east + padLng)),
  }
}

export type MapPropertiesResult = {
  properties: PropertyWithCounts[]
  ownerContext: Map<string, OwnerContext>
  /** How many properties the box actually holds, before the cap — for "1,200 of 3,386". */
  totalInView: number
}

const EMPTY: MapPropertiesResult = {
  properties: [],
  ownerContext: new Map(),
  totalInView: 0,
}

/**
 * The properties inside the current camera, with their owner context attached.
 *
 * The map's data source when nothing is being searched for. Plotting from the whole book
 * meant ~17k properties and ~17k rows of owner context before a single pin could appear;
 * a viewport holds a few hundred, and the database can hand those over — owner context
 * and all — in one round trip. Pins are therefore no longer opt-in: zoom anywhere and the
 * properties there are on screen and clickable, with no search to type first.
 */
export function useMapProperties(viewport: MapViewport | null, enabled = true) {
  const box = useMemo(
    () => (viewport ? snapBox(viewport) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewport?.south, viewport?.west, viewport?.north, viewport?.east],
  )

  const query = useQuery({
    queryKey: ['map-properties', box],
    enabled: enabled && box != null,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    // Hold the pins from the previous box on screen while the new one loads, so panning
    // doesn't strobe the map empty between frames.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<MapPropertiesResult> => {
      const { data, error } = await supabase.rpc('map_properties', {
        p_min_lat: box!.south,
        p_min_lng: box!.west,
        p_max_lat: box!.north,
        p_max_lng: box!.east,
        p_limit: MAP_VIEWPORT_LIMIT,
      })
      if (error) throw error
      const rows = (data ?? []) as {
        property: unknown
        owner_ctx: unknown
        total_in_view: number
      }[]
      const properties: PropertyWithCounts[] = []
      const ownerContext = new Map<string, OwnerContext>()
      for (const row of rows) {
        // Deal counts are the one thing a map row doesn't carry: they cost a subquery per
        // property and only the table's Deals column reads them. Empty rather than absent
        // so a map row is the same shape as a book row everywhere downstream.
        const p = { ...(row.property as PropertyWithCounts), listings: [], matches: [] }
        properties.push(p)
        if (row.owner_ctx) ownerContext.set(p.id, row.owner_ctx as OwnerContext)
      }
      return { properties, ownerContext, totalInView: rows[0]?.total_in_view ?? 0 }
    },
  })

  return { ...query, data: query.data ?? EMPTY }
}
