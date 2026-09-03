import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { GeoJSON, useMap, useMapEvents } from 'react-leaflet'
import type { Feature, Geometry } from 'geojson'
import {
  EASEMENT_COLOR,
  ELECTRIC_COLOR,
  GAS_COLOR,
  ROW_COLOR,
  SEWER_COLOR,
  WATER_COLOR,
  utilityKindsForZoom,
} from '@/lib/map-layers'
import type { OverlayState } from '@/lib/overlays'
import { useMapLayerFeatures, type LayerFC, type LayerFeatureProps, type LayerView } from '@/hooks/use-map-layers'

/**
 * Utilities and easements on the map, Paxiv-style: water blue, sewer pink (force
 * mains dashed), service areas as dashed outlines, electric amber, gas violet,
 * easements orange hatching on the parcel. Line weight follows pipe diameter (and
 * kV for transmission) so a 24" trunk reads differently from a 4" lateral.
 *
 * Panes: easements at 355 sit just ABOVE the parcel outlines (350) so a strip stays
 * hoverable through a parcel's fill; utility lines at 360; both under the pins (400).
 * Canvas renderers — a street-level viewport holds a few thousand segments, and SVG
 * chokes panning long before canvas does. Hover/tap shows the feature's facts.
 */
const UTILITY_PANE = 'utilityLines'
const EASEMENT_PANE = 'easements'

function ensurePanes(map: L.Map) {
  if (!map.getPane(EASEMENT_PANE)) map.createPane(EASEMENT_PANE).style.zIndex = '355'
  if (!map.getPane(UTILITY_PANE)) map.createPane(UTILITY_PANE).style.zIndex = '360'
}

function viewOf(map: L.Map): LayerView {
  const b = map.getBounds()
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth(), zoom: map.getZoom() }
}

/** The camera, settled (250 ms after the last move) — what the RPC is asked about. */
function useSettledView(): LayerView {
  const map = useMap()
  // the first answer comes from wherever the map already is; every later one from a
  // settled moveend (SizeWatcher fires one after the first real layout, so a map
  // that mounted at 0x0 corrects itself)
  const [view, setView] = useState<LayerView>(() => viewOf(map))
  const timer = useRef<number | null>(null)
  const schedule = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setView(viewOf(map)), 250)
  }
  useMapEvents({ moveend: schedule, zoomend: schedule })
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    [],
  )
  return view
}

const NUM = new Intl.NumberFormat('en-US')

const KIND_LABEL: Record<string, string> = {
  water_main: 'Water main',
  sewer_gravity: 'Gravity sewer',
  sewer_force: 'Sewer force main',
  water_service_area: 'Water service area',
  sewer_service_area: 'Sewer service area',
  electric_transmission: 'Transmission line',
  electric_substation: 'Substation',
  gas_transmission: 'Gas transmission',
  easement: 'Easement',
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

/** The hover card: what Paxiv shows on a click — status, diameter, material, ownership. */
function layerTooltipHtml(p: LayerFeatureProps): string {
  const title =
    p.k === 'easement'
      ? p.sub === 'row'
        ? 'Right of way'
        : p.sub === 'vacated'
          ? 'Vacated / released'
          : p.label || 'Easement'
      : KIND_LABEL[p.k] ?? p.k
  const rows: [string, string | undefined][] = [
    ['Type', p.k === 'easement' && p.label && p.label !== title ? p.label : undefined],
    ['Name', p.name],
    ['Diameter', p.dia != null ? `${NUM.format(p.dia)}"` : undefined],
    ['Voltage', p.kv != null ? `${NUM.format(p.kv)} kV` : undefined],
    ['Material', p.mat],
    ['Status', p.st],
    ['Owner', p.own],
    ['Installed', p.yr != null ? String(p.yr) : undefined],
    ['Recorded', p.ref],
    ['Source', p.j],
  ]
  const body = rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#64748b">${k}</span><span>${esc(v)}</span></div>`,
    )
    .join('')
  return `<div style="min-width:180px;font-size:12px;line-height:1.35"><div style="font-weight:600;margin-bottom:3px">${esc(title)}</div>${body}</div>`
}

function styleFor(p: LayerFeatureProps): L.PathOptions {
  // 4" reads ~1.6 px, 12" ~2.5, 36" ~5 — visible hierarchy without a legend key
  const w = p.dia != null ? 1.2 + Math.min(p.dia, 48) / 9 : 1.8
  switch (p.k) {
    case 'water_main':
      return { color: WATER_COLOR, weight: w, opacity: 0.95 }
    case 'sewer_gravity':
      return { color: SEWER_COLOR, weight: w, opacity: 0.95 }
    case 'sewer_force':
      return { color: SEWER_COLOR, weight: w, opacity: 0.95, dashArray: '8 5' }
    case 'water_service_area':
      return { color: WATER_COLOR, weight: 2, opacity: 0.8, dashArray: '10 6', fill: true, fillColor: WATER_COLOR, fillOpacity: 0.03 }
    case 'sewer_service_area':
      return { color: SEWER_COLOR, weight: 2, opacity: 0.8, dashArray: '10 6', fill: true, fillColor: SEWER_COLOR, fillOpacity: 0.03 }
    case 'electric_transmission':
      return { color: ELECTRIC_COLOR, weight: p.kv != null ? 1.5 + Math.min(p.kv, 500) / 125 : 2, opacity: 0.95 }
    case 'gas_transmission':
      return { color: GAS_COLOR, weight: 2.5, opacity: 0.95, dashArray: '2 6' }
    case 'easement':
      if (p.sub === 'row') return { color: ROW_COLOR, weight: 1, opacity: 0.8, dashArray: '3 3', fill: true, fillColor: ROW_COLOR, fillOpacity: 0.08 }
      if (p.sub === 'vacated') return { color: ROW_COLOR, weight: 1, opacity: 0.6, dashArray: '2 4', fill: false }
      return { color: EASEMENT_COLOR, weight: 1.5, opacity: 0.95, dashArray: '5 4', fill: true, fillColor: EASEMENT_COLOR, fillOpacity: 0.18 }
    default:
      return { color: '#94a3b8', weight: 1.5 }
  }
}

export type LayerStatus = {
  loading: boolean
  count: number
  truncated: boolean
  /** layers that are ON but waiting for the camera to come closer */
  waiting: string[]
}

/**
 * Mount inside a MapContainer. `state` says which layers are on; the component asks
 * the RPC for what the camera can see and paints it. `onStatus` feeds the legend
 * outside the map (count / truncated / "zoom in for …").
 */
export function MapLayers({
  state,
  onStatus,
}: {
  state: Pick<OverlayState, 'utilities' | 'easements'>
  onStatus?: (s: LayerStatus) => void
}) {
  const map = useMap()
  ensurePanes(map)
  const [utilityRenderer] = useState(() => L.canvas({ pane: UTILITY_PANE }))
  const [easementRenderer] = useState(() => L.canvas({ pane: EASEMENT_PANE }))
  const view = useSettledView()

  const { kinds, waiting } = useMemo(
    () => utilityKindsForZoom(state.utilities, state.easements, view.zoom),
    [state.utilities, state.easements, view.zoom],
  )
  const { data, isFetching } = useMapLayerFeatures(kinds, view, kinds.length > 0)

  // split once per answer: easements and utilities live in different panes
  const split = useMemo(() => {
    const fc = kinds.length > 0 ? data : undefined
    const feats = fc?.features ?? []
    const ez = feats.filter((f) => f.properties.k === 'easement')
    const ut = feats.filter((f) => f.properties.k !== 'easement')
    return { ez, ut, truncated: !!fc?.truncated, count: feats.length }
  }, [data, kinds.length])

  useEffect(() => {
    onStatus?.({ loading: isFetching && kinds.length > 0, count: split.count, truncated: split.truncated, waiting })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFetching, split.count, split.truncated, waiting.join('|'), kinds.length])

  // GeoJSON only reads `data` on mount, so a fresh answer needs a fresh key
  const dataKey = useMemo(() => `${kinds.join('|')}:${split.count}:${split.ez.length}:${data ? 1 : 0}`, [kinds, split, data])

  const bindHover = (feature: Feature<Geometry, LayerFeatureProps>, layer: L.Layer) => {
    layer.bindTooltip(() => layerTooltipHtml(feature.properties), { sticky: true, opacity: 1 })
  }

  if (kinds.length === 0) return null
  return (
    <>
      {split.ez.length > 0 && (
        <GeoJSON
          key={`ez-${dataKey}`}
          data={{ type: 'FeatureCollection', features: split.ez } as LayerFC}
          style={(f) => ({ pane: EASEMENT_PANE, renderer: easementRenderer, ...styleFor((f as Feature<Geometry, LayerFeatureProps>).properties) })}
          onEachFeature={bindHover}
        />
      )}
      {split.ut.length > 0 && (
        <GeoJSON
          key={`ut-${dataKey}`}
          data={{ type: 'FeatureCollection', features: split.ut } as LayerFC}
          style={(f) => ({ pane: UTILITY_PANE, renderer: utilityRenderer, ...styleFor((f as Feature<Geometry, LayerFeatureProps>).properties) })}
          pointToLayer={(f, latlng) =>
            L.circleMarker(latlng, {
              pane: UTILITY_PANE,
              renderer: utilityRenderer,
              radius: 5,
              color: '#fff',
              weight: 1.5,
              fillColor: ELECTRIC_COLOR,
              fillOpacity: 0.95,
              ...(f.properties.k === 'electric_substation' ? {} : { fillColor: '#94a3b8' }),
            })
          }
          onEachFeature={bindHover}
        />
      )}
    </>
  )
}
