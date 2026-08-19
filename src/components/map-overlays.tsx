import { useMemo, useState } from 'react'
import L from 'leaflet'
import { GeoJSON, useMap } from 'react-leaflet'
import { OVERLAY_COLORS, featurePaints, overlayBucket, type OverlayState } from '@/lib/overlays'
import { useZoningOverlay, type ZoningFeature } from '@/hooks/use-overlays'
import { useIndustrialCrossovers } from '@/hooks/use-zoning-map'

/**
 * The district overlay lives UNDER the parcel outlines (350) and pins (400): it is
 * ground truth to read through, never something to click — the pane swallows no
 * pointer events. (A lowlands pane lived at 340 until 2026-08-16; wiped, see
 * lib/overlays.ts.)
 */
const ZONING_PANE = 'zoningOverlay' // z 330

function ensureOverlayPane(map: L.Map) {
  if (!map.getPane(ZONING_PANE)) {
    const p = map.createPane(ZONING_PANE)
    p.style.zIndex = '330'
    p.style.pointerEvents = 'none'
  }
}

/**
 * Whole zoning districts, painted from the prebuilt GeoJSON artifact.
 *
 * Canvas renderer, not SVG: the artifact carries county-sized multipolygons with
 * thousands of vertices, and the SVG DOM chokes panning long before canvas does.
 * The layer is remounted (via key) when the checked set changes — a rebuild of a
 * few hundred features is fast, and Leaflet's GeoJSON layer cannot restyle a filter
 * in place anyway.
 */
export function MapOverlays({ state }: { state: OverlayState }) {
  const map = useMap()
  ensureOverlayPane(map)
  // One renderer, created once — recreating it would orphan the old canvas.
  const [zoningRenderer] = useState(() => L.canvas({ pane: ZONING_PANE }))

  const anyZoning =
    state.industrial !== 'off' || state.retail !== 'off' ||
    state.office !== 'off' || state.multifamily !== 'off'
  const { data: zoningFc } = useZoningOverlay(anyZoning)
  // Which layer a crossover district files under comes from the DB, not the artifact's
  // baked flag — see overlayBucket.
  const { data: crossovers } = useIndustrialCrossovers()

  // The filter is baked into the layer at creation, so the key must change whenever
  // the answer to "does this district paint?" can change — including the crossover
  // set landing (or changing size after a reclassification).
  const selectionKey = useMemo(
    () => JSON.stringify([state.industrial, state.retail, state.office, state.multifamily, crossovers?.size ?? -1]),
    [state.industrial, state.retail, state.office, state.multifamily, crossovers],
  )

  if (!anyZoning || !zoningFc) return null
  return (
    <GeoJSON
      key={selectionKey}
      data={zoningFc}
      interactive={false}
      filter={(f) => featurePaints((f as ZoningFeature).properties, state, crossovers)}
      style={(f) => {
        const bucket = overlayBucket((f as ZoningFeature).properties, crossovers)
        const color = bucket ? OVERLAY_COLORS[bucket] : '#94a3b8'
        return {
          pane: ZONING_PANE,
          renderer: zoningRenderer,
          interactive: false,
          color,
          weight: 1,
          opacity: 0.5,
          fillColor: color,
          fillOpacity: 0.28,
        }
      }}
    />
  )
}
