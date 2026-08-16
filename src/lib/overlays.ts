import { isZonedIndustrial } from '@/hooks/use-zoning-map'

/**
 * The map overlays (War Room overhaul Phase 1): whole zoning districts painted as
 * coloured shapes, Mapwise-style, plus NWI lowlands — check on/off, not separate maps.
 *
 * The artifacts are prebuilt GeoJSON in the PUBLIC `map-overlays` storage bucket
 * (built by data/zoning/build_overlays.py from the 21 cached county/city layers and
 * the NWI wetlands extract). Versioned filenames + immutable cache headers: a refresh
 * is a NEW file and a constant bump here, never a cache fight.
 *
 * Every zoning feature is one dissolved (jurisdiction, code) district carrying
 * `{j, c, t, i, d}` — jurisdiction, code, zoning_type, allows_industrial, description.
 * The overlay and `properties.zoning_*` come from the same pipeline, so "inside the
 * industrial overlay" ≡ "row matches (jurisdiction, code)" — which is what lets
 * "Include in search" be a filter-union over row fields instead of point-in-polygon.
 */
export const OVERLAY_ZONING_URL = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/map-overlays/overlay_zoning.v1.geojson`
// The NWI lowlands overlay was wiped 2026-08-16 (Alex: "cover sucks") — at county zoom
// NWI paints half of inland Florida as forested wetland, which is noise for his
// workflow; parcel-level wet already lives in usable_acres on the property page. The
// artifact + builder (data/zoning/build_overlays.py, bucket map-overlays) stay dormant
// in case a better source appears.

export type OverlayType = 'industrial' | 'retail' | 'office' | 'multifamily'
export const OVERLAY_TYPES: OverlayType[] = ['industrial', 'retail', 'office', 'multifamily']

/** Alex's colour spec (2026-08-15b). */
export const OVERLAY_COLORS: Record<OverlayType, string> = {
  industrial: '#dc2626',
  retail: '#16a34a',
  office: '#2563eb',
  multifamily: '#9333ea',
}

export const OVERLAY_LABELS: Record<OverlayType, string> = {
  industrial: 'Industrial',
  retail: 'Retail',
  office: 'Office',
  multifamily: 'Multifamily',
}

/**
 * What one layer paints: nothing, every code in its bucket, or an explicit checked
 * set of `jurisdiction|code` keys (the per-code granularity — "only IG highlighted").
 */
export type LayerSelection = 'off' | 'all' | string[]

export type OverlayState = {
  industrial: LayerSelection
  retail: LayerSelection
  office: LayerSelection
  multifamily: LayerSelection
  /** Layers whose properties JOIN the filtered set (union) so exports carry them. */
  include: Partial<Record<OverlayType, boolean>>
}

export const OVERLAY_DEFAULT: OverlayState = {
  industrial: 'off',
  retail: 'off',
  office: 'off',
  multifamily: 'off',
  include: {},
}

/** A persisted value predating a shape change (or hand-edited) must not crash the map —
 * this also silently drops the retired `lowlands` flag from pre-wipe sessions. */
export function safeOverlayState(v: unknown): OverlayState {
  const o = (v ?? {}) as Partial<OverlayState>
  const sel = (s: unknown): LayerSelection =>
    s === 'all' || s === 'off' ? s : Array.isArray(s) ? s.filter((k): k is string => typeof k === 'string') : 'off'
  return {
    industrial: sel(o.industrial),
    retail: sel(o.retail),
    office: sel(o.office),
    multifamily: sel(o.multifamily),
    include: typeof o.include === 'object' && o.include != null ? o.include : {},
  }
}

export const overlayKey = (jurisdiction: string, code: string) => `${jurisdiction}|${code}`

/** Feature props as built into overlay_zoning.v1.geojson. */
export type ZoningFeatureProps = {
  j: string
  c: string
  t: string
  i: boolean
  d: string
}

/**
 * Which layer a district belongs to. Industrial-capable crossovers (Hillsborough
 * CG/CI, Polk BPC) live under Industrial — "zoned industrial" means allows_industrial
 * everywhere in the app, and the overlay must agree with the filter.
 */
export function overlayBucket(p: ZoningFeatureProps): OverlayType | null {
  if (p.i) return 'industrial'
  return p.t === 'retail' || p.t === 'office' || p.t === 'multifamily' ? p.t : null
}

/** Does the current selection paint this district? */
export function featurePaints(p: ZoningFeatureProps, state: OverlayState): boolean {
  const bucket = overlayBucket(p)
  if (!bucket) return false
  const sel = state[bucket]
  if (sel === 'off') return false
  if (sel === 'all') return true
  return sel.includes(overlayKey(p.j, p.c))
}

type ZonedRow = {
  zoning_type: string | null
  zoning_jurisdiction: string | null
  zoning_code: string | null
}

/**
 * Is this property inside the overlay a layer is painting? Same (jurisdiction, code)
 * vocabulary as the shapes, evaluated on the row's own zoning fields — no geometry.
 * Industrial 'all' = the allows_industrial set, exactly like the zoning filter.
 */
export function rowInOverlay(
  row: ZonedRow,
  type: OverlayType,
  sel: LayerSelection,
  crossovers: Set<string> | undefined,
): boolean {
  if (sel === 'off') return false
  if (sel !== 'all') {
    if (!row.zoning_jurisdiction || !row.zoning_code) return false
    return sel.includes(overlayKey(row.zoning_jurisdiction, row.zoning_code))
  }
  if (type === 'industrial') return isZonedIndustrial(row, crossovers)
  // The crossovers live under Industrial, so the retail 'all' set here is
  // t='retail' minus them — matching overlayBucket, not raw zoning_type… but the
  // crossover rows still have zoning_type='retail'. Exclude them so the shapes and
  // the union agree about what "the retail layer" contains.
  if (type === 'retail' && isZonedIndustrial(row, crossovers)) return false
  return row.zoning_type === type
}

/** The layers currently unioning their properties into the filtered set. */
export function activeIncludes(state: OverlayState): OverlayType[] {
  return OVERLAY_TYPES.filter((t) => state.include[t] && state[t] !== 'off')
}
