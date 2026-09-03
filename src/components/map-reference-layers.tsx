import { useEffect, useState } from 'react'
import L from 'leaflet'
import { GeoJSON, useMap, useMapEvents } from 'react-leaflet'
import type { MultiPolygon, Polygon, Position } from 'geojson'
import { CITY_LINE_COLOR, COUNTY_LINE_COLOR, STREETS_TILE_URL } from '@/lib/map-layers'
import type { OverlayState } from '@/lib/overlays'
import { boundaryName, useCityLimits, useCountyLines, type BoundaryFC } from '@/hooks/use-reference-layers'

/**
 * The reference overlays — streets + road names, city limits, county lines — the
 * labels an aerial basemap has none of.
 *
 * Panes: the street tiles at 335 and the boundary lines at 340 sit ABOVE the zoning
 * fills (330) so a road name stays legible through a red industrial district, and
 * below the parcel outlines (350) and pins (400). The name labels get their own pane
 * at 345 rather than Leaflet's tooltip pane (650), so a city name never covers a
 * pin's hover card. Nothing here takes pointer events — it is ground to read
 * through, never something to click.
 */
const STREETS_PANE = 'referenceStreets'
const BOUNDARY_PANE = 'referenceBoundaries'
const LABEL_PANE = 'referenceLabels'

function ensurePanes(map: L.Map) {
  const mk = (name: string, z: string) => {
    if (map.getPane(name)) return
    const p = map.createPane(name)
    p.style.zIndex = z
    p.style.pointerEvents = 'none'
  }
  mk(STREETS_PANE, '335')
  mk(BOUNDARY_PANE, '340')
  mk(LABEL_PANE, '345')
}

/** City names crowd each other below this; county names read at any zoom. */
const CITY_LABEL_MIN_ZOOM = 10

/** Area-weighted centroid of the largest ring — the bounds centre of an L-shaped
 * city (Tampa) lands in the bay. Positions are [lng, lat]. */
function labelPoint(geom: Polygon | MultiPolygon): L.LatLng {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  let best: { area: number; x: number; y: number } | null = null
  for (const poly of polys) {
    const ring: Position[] = poly[0] ?? []
    let a = 0
    let cx = 0
    let cy = 0
    for (let i = 0, n = ring.length; i < n; i++) {
      const [x0, y0] = ring[i]
      const [x1, y1] = ring[(i + 1) % n]
      const f = x0 * y1 - x1 * y0
      a += f
      cx += (x0 + x1) * f
      cy += (y0 + y1) * f
    }
    if (a === 0) continue
    const area = Math.abs(a / 2)
    if (!best || area > best.area) best = { area, x: cx / (3 * a), y: cy / (3 * a) }
  }
  if (!best) {
    const first = polys[0]?.[0]?.[0]
    return L.latLng(first?.[1] ?? 0, first?.[0] ?? 0)
  }
  return L.latLng(best.y, best.x)
}

/** Permanent name labels for every feature, added straight to the map (not through
 * react-leaflet — a Tooltip child needs a parent layer, and these belong to no shape). */
function useNameLabels(fc: BoundaryFC | undefined, on: boolean, className: string) {
  const map = useMap()
  useEffect(() => {
    if (!on || !fc) return
    const labels = fc.features.map((f) =>
      L.tooltip({
        pane: LABEL_PANE,
        permanent: true,
        direction: 'center',
        interactive: false,
        opacity: 1,
        className: `map-ref-label ${className}`,
      })
        .setLatLng(labelPoint(f.geometry))
        .setContent(boundaryName(f.properties)),
    )
    labels.forEach((t) => t.addTo(map))
    return () => {
      labels.forEach((t) => map.removeLayer(t))
    }
  }, [map, fc, on, className])
}

function StreetTiles() {
  const map = useMap()
  useEffect(() => {
    const layer = L.tileLayer(STREETS_TILE_URL, {
      pane: STREETS_PANE,
      maxNativeZoom: 19,
      maxZoom: 22,
      attribution: 'Esri',
    })
    layer.addTo(map)
    return () => {
      map.removeLayer(layer)
    }
  }, [map])
  return null
}

/** Mount inside a MapContainer. */
export function MapReferenceLayers({ state }: { state: OverlayState }) {
  const map = useMap()
  ensurePanes(map)
  const ref = state.reference
  const [zoom, setZoom] = useState(() => map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })

  const { data: counties } = useCountyLines(!!ref.counties)
  const { data: cities } = useCityLimits(!!ref.cities)

  // One renderer per boundary set, created once — recreating orphans the old canvas.
  const [renderer] = useState(() => L.canvas({ pane: BOUNDARY_PANE }))

  useNameLabels(counties, !!ref.counties, 'map-ref-label-county')
  useNameLabels(cities, !!ref.cities && zoom >= CITY_LABEL_MIN_ZOOM, 'map-ref-label-city')

  // react-leaflet re-applies `style` via setStyle whenever the prop changes, so the
  // zoom-dependent weight updates in place without remounting the layer.
  const lineStyle = (color: string, weight: number, dashArray?: string): L.PathOptions => ({
    pane: BOUNDARY_PANE,
    renderer,
    interactive: false,
    color,
    weight,
    opacity: 0.9,
    dashArray,
    fill: false,
  })

  return (
    <>
      {ref.streets && <StreetTiles />}
      {ref.counties && counties && (
        <GeoJSON
          key="counties"
          data={counties}
          interactive={false}
          style={() => lineStyle(COUNTY_LINE_COLOR, zoom >= 12 ? 3 : 2, '8 6')}
        />
      )}
      {ref.cities && cities && (
        <GeoJSON
          key="cities"
          data={cities}
          interactive={false}
          style={() => lineStyle(CITY_LINE_COLOR, zoom >= 12 ? 2 : 1.25)}
        />
      )}
    </>
  )
}
