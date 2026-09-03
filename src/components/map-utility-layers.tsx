import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { GeoJSON, useMap, useMapEvents } from 'react-leaflet'
import type { Feature, Geometry } from 'geojson'
import {
  EASEMENT_COLOR,
  ELECTRIC_COLOR,
  GAS_COLOR,
  RAIL_COLOR,
  ROW_COLOR,
  FLOOD_COLOR,
  FLOOD_02_COLOR,
  FLOODWAY_COLOR,
  COASTAL_COLOR,
  WETLAND_COLOR,
  WETLAND_WATER_COLOR,
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
/** flood zones + wetlands: ground truth to read through, under the zoning districts (330)
 * and everything else — the same slot the 2026-08 lowlands overlay used */
const GROUND_PANE = 'groundLayers'

function ensurePanes(map: L.Map) {
  if (!map.getPane(GROUND_PANE)) map.createPane(GROUND_PANE).style.zIndex = '325'
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
  rail_line: 'Railroad',
  rail_crossing: 'Grade crossing',
  flood_zone: 'FEMA flood zone',
  wetland: 'Wetland (NWI)',
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
    ['Zone', p.zone],
    ['Name', p.name],
    ['BFE', p.bfe != null ? `${NUM.format(p.bfe)} ft` : undefined],
    ['NWI code', p.code],
    ['Acres', p.acres != null ? NUM.format(Math.round(p.acres * 10) / 10) : undefined],
    ['Street', p.street],
    ['Tracks', p.tracks != null ? String(p.tracks) : undefined],
    ['Passenger', p.pass],
    [
      'Trains / day',
      p.tpd != null
        ? `${NUM.format(p.tpd)}${p.tpd_day != null || p.tpd_night != null ? ` (${p.tpd_day ?? 0} day / ${p.tpd_night ?? 0} night)` : ''}`
        : undefined,
    ],
    ['Max speed', p.spd != null ? `${NUM.format(p.spd)} mph` : undefined],
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
    case 'rail_line': {
      // main lines heavy, branches / industrial leads lighter, abandoned + out of service
      // faded and dashed — the white tie pattern is painted by a second pass below
      const dead = p.st === 'Abandoned' || p.st === 'Out of service' || p.st === 'Trail'
      const main = p.st === 'Main line'
      return {
        color: RAIL_COLOR,
        weight: main ? 4 : 3,
        opacity: dead ? 0.45 : 0.95,
        dashArray: dead ? '6 6' : undefined,
      }
    }
    case 'flood_zone': {
      // FEMA's own palette, translucent: SFHA blue, coastal high hazard purple, floodway
      // navy, the 0.2% (shaded X) amber
      const c =
        p.sub === 'floodway' ? FLOODWAY_COLOR
        : p.sub === '0.2%' ? FLOOD_02_COLOR
        : p.zone?.startsWith('V') ? COASTAL_COLOR
        : FLOOD_COLOR
      return { color: c, weight: 1, opacity: 0.7, fill: true, fillColor: c, fillOpacity: p.sub === 'floodway' ? 0.35 : 0.22 }
    }
    case 'wetland': {
      // open water (ponds, lakes, estuarine) teal; vegetated wetlands green
      const water = /pond|lake|estuarine|marine|riverine/i.test(p.name ?? '')
      const c = water ? WETLAND_WATER_COLOR : WETLAND_COLOR
      return { color: c, weight: 1, opacity: 0.8, fill: true, fillColor: c, fillOpacity: water ? 0.25 : 0.32 }
    }
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
  const [groundRenderer] = useState(() => L.canvas({ pane: GROUND_PANE }))
  const view = useSettledView()

  const { kinds, waiting } = useMemo(
    () => utilityKindsForZoom(state.utilities, state.easements, view.zoom),
    [state.utilities, state.easements, view.zoom],
  )
  const { data, isFetching } = useMapLayerFeatures(kinds, view, kinds.length > 0)

  // split once per answer: easements and utilities live in different panes; live rail
  // lines get a second pass (white ties over the dark rail) so they read as railroad
  const split = useMemo(() => {
    const fc = kinds.length > 0 ? data : undefined
    const feats = fc?.features ?? []
    const ez = feats.filter((f) => f.properties.k === 'easement')
    const ground = feats.filter((f) => f.properties.k === 'flood_zone' || f.properties.k === 'wetland')
    const ut = feats.filter((f) => f.properties.k !== 'easement' && f.properties.k !== 'flood_zone' && f.properties.k !== 'wetland')
    const ties = feats.filter(
      (f) => f.properties.k === 'rail_line' && !['Abandoned', 'Out of service', 'Trail'].includes(f.properties.st ?? ''),
    )
    return { ez, ut, ground, ties, truncated: !!fc?.truncated, count: feats.length }
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
      {split.ground.length > 0 && (
        <GeoJSON
          key={`ground-${dataKey}`}
          data={{ type: 'FeatureCollection', features: split.ground } as LayerFC}
          style={(f) => ({ pane: GROUND_PANE, renderer: groundRenderer, ...styleFor((f as Feature<Geometry, LayerFeatureProps>).properties) })}
          onEachFeature={bindHover}
        />
      )}
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
              radius: f.properties.k === 'rail_crossing' ? 4 : 5,
              color: '#fff',
              weight: 1.5,
              fillColor:
                f.properties.k === 'electric_substation'
                  ? ELECTRIC_COLOR
                  : f.properties.k === 'rail_crossing'
                    ? RAIL_COLOR
                    : '#94a3b8',
              fillOpacity: 0.95,
            })
          }
          onEachFeature={bindHover}
        />
      )}
      {split.ties.length > 0 && (
        <GeoJSON
          key={`ties-${dataKey}`}
          data={{ type: 'FeatureCollection', features: split.ties } as LayerFC}
          style={() => ({ pane: UTILITY_PANE, renderer: utilityRenderer, color: '#ffffff', weight: 1.5, opacity: 0.9, dashArray: '6 6', interactive: false })}
        />
      )}
    </>
  )
}
