import { useMemo, useState } from 'react'
import L from 'leaflet'
import { GeoJSON, useMap } from 'react-leaflet'
import {
  LOWLANDS_COLOR,
  OVERLAY_COLORS,
  featurePaints,
  overlayBucket,
  type OverlayState,
} from '@/lib/overlays'
import { useLowlandsOverlay, useZoningOverlay, type ZoningFeature } from '@/hooks/use-overlays'

/**
 * The district overlays live UNDER the parcel outlines (350) and pins (400): they are
 * ground truth to read through, never something to click. Lowlands paints above the
 * zoning colour so "this corner of the red district is swamp" reads as one picture.
 * Both panes swallow no pointer events — clicks land on pins and parcels as before.
 */
const ZONING_PANE = 'zoningOverlay' // z 330
const LOWLANDS_PANE = 'lowlandsOverlay' // z 340

function ensureOverlayPanes(map: L.Map) {
  if (!map.getPane(ZONING_PANE)) {
    const p = map.createPane(ZONING_PANE)
    p.style.zIndex = '330'
    p.style.pointerEvents = 'none'
  }
  if (!map.getPane(LOWLANDS_PANE)) {
    const p = map.createPane(LOWLANDS_PANE)
    p.style.zIndex = '340'
    p.style.pointerEvents = 'none'
  }
}

/**
 * Whole zoning districts + lowlands, painted from the prebuilt GeoJSON artifacts.
 *
 * Canvas renderers, not SVG: the artifacts carry county-sized multipolygons with
 * thousands of vertices, and the SVG DOM chokes panning long before canvas does.
 * The layers are remounted (via key) when the checked set changes — a rebuild of a
 * few hundred features is fast, and Leaflet's GeoJSON layer cannot restyle a filter
 * in place anyway.
 */
export function MapOverlays({ state }: { state: OverlayState }) {
  const map = useMap()
  ensureOverlayPanes(map)
  // One renderer per pane, created once — recreating them would orphan the old canvas.
  const [zoningRenderer] = useState(() => L.canvas({ pane: ZONING_PANE }))
  const [lowlandsRenderer] = useState(() => L.canvas({ pane: LOWLANDS_PANE }))

  const anyZoning =
    state.industrial !== 'off' || state.retail !== 'off' ||
    state.office !== 'off' || state.multifamily !== 'off'
  const { data: zoningFc } = useZoningOverlay(anyZoning)
  const { data: lowlandsFc } = useLowlandsOverlay(state.lowlands)

  // The filter is baked into the layer at creation, so the key must change whenever
  // the answer to "does this district paint?" can change.
  const selectionKey = useMemo(
    () => JSON.stringify([state.industrial, state.retail, state.office, state.multifamily]),
    [state.industrial, state.retail, state.office, state.multifamily],
  )

  return (
    <>
      {anyZoning && zoningFc && (
        <GeoJSON
          key={selectionKey}
          data={zoningFc}
          interactive={false}
          filter={(f) => featurePaints((f as ZoningFeature).properties, state)}
          style={(f) => {
            const bucket = overlayBucket((f as ZoningFeature).properties)
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
      )}
      {state.lowlands && lowlandsFc && (
        <GeoJSON
          key="lowlands"
          data={lowlandsFc}
          interactive={false}
          style={{
            pane: LOWLANDS_PANE,
            renderer: lowlandsRenderer,
            interactive: false,
            stroke: false,
            fillColor: LOWLANDS_COLOR,
            // Higher than the zoning fills on purpose: the satellite basemap is
            // itself green, and 0.22 vanished into the vegetation (checked on the
            // dev server). Swampy-muted comes from the hue, not from being faint.
            fillOpacity: 0.45,
          }}
        />
      )}
    </>
  )
}
