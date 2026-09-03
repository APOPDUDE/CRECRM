import { useQuery } from '@tanstack/react-query'
import type { FeatureCollection, Geometry } from 'geojson'
import { supabase } from '@/lib/supabase'

/** The normalized props map_layer_features() puts on every feature. */
export type LayerFeatureProps = {
  /** catalog kind: water_main, sewer_gravity, sewer_force, water_service_area,
   * sewer_service_area, electric_transmission, electric_substation, gas_transmission, easement */
  k: string
  /** easement sub-kind: easement | row | vacated */
  sub?: string
  /** jurisdiction / publisher */
  j?: string
  name?: string
  label?: string
  /** pipe diameter, inches */
  dia?: number
  mat?: string
  st?: string
  own?: string
  /** recorded instrument reference (OR book/page, plat book/page) */
  ref?: string
  /** rail: tracks on the segment; passenger service; trains per day (day / night) and max
   * timetable speed at a crossing; the street a crossing sits on */
  tracks?: number
  pass?: string
  tpd?: number
  tpd_day?: number
  tpd_night?: number
  spd?: number
  street?: string
  link?: string
  /** install year */
  yr?: number
  kv?: number
}

export type LayerFC = FeatureCollection<Geometry, LayerFeatureProps> & { truncated?: boolean }

export type LayerView = { west: number; south: number; east: number; north: number; zoom: number }

/**
 * Snap the viewport out to a grid cell so a nudge of the map reuses the cached
 * answer instead of asking again: ~300 m cells on a block, ~1 km at street zoom,
 * ~5 km further out. Coarser than this and a zoom-15 viewport in Tampa asked for
 * 4,000 mains (3 MB) instead of the ~800 on screen.
 */
function snapView(v: LayerView): LayerView {
  const step = v.zoom >= 16 ? 0.003 : v.zoom >= 14 ? 0.008 : 0.05
  const down = (n: number) => Math.floor(n / step) * step
  const up = (n: number) => Math.ceil(n / step) * step
  return { west: down(v.west), south: down(v.south), east: up(v.east), north: up(v.north), zoom: v.zoom }
}

/**
 * Utility + easement features for a viewport, from our own cache. One RPC per
 * (kinds, snapped bbox, zoom); the previous answer stays on screen while the next
 * loads so a pan never blanks the lines.
 */
export function useMapLayerFeatures(kinds: string[], view: LayerView | null, enabled = true) {
  const sorted = [...kinds].sort()
  const snapped = view ? snapView(view) : null
  const key = snapped
    ? [snapped.west, snapped.south, snapped.east, snapped.north, snapped.zoom].map((n) => n.toFixed(3)).join(',')
    : null
  return useQuery({
    queryKey: ['map-layers', sorted.join('|'), key],
    enabled: enabled && !!snapped && sorted.length > 0,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('map_layer_features', {
        p_kinds: sorted,
        p_west: snapped!.west,
        p_south: snapped!.south,
        p_east: snapped!.east,
        p_north: snapped!.north,
        p_zoom: snapped!.zoom,
      })
      if (error) throw error
      return data as unknown as LayerFC
    },
  })
}
