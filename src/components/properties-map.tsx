import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import { CircleMarker, GeoJSON, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { propertyKindLabels } from '@/components/property-form-dialog'
import type { Property } from '@/hooks/use-properties'
import type { OwnerContext } from '@/hooks/use-owners'
import { formatCurrency, formatPsf, formatSf } from '@/lib/format'
import type { CurrentAsking } from '@/hooks/use-comps'
import type { LeaseComp } from '@/hooks/use-lease-comps'
import { pointInPolygon, type LatLng } from '@/lib/geo'
import { isZonedIndustrial } from '@/hooks/use-zoning-map'
import type { Geometry } from 'geojson'
import { MapOverlays } from '@/components/map-overlays'
import type { OverlayState } from '@/lib/overlays'

// CircleMarkers are cheap (SVG), but each mounts a hover Tooltip, so a few hundred is
// the comfortable ceiling on a phone. Desktop has the headroom for the whole book, so
// the cap is viewport-dependent rather than a single conservative number.
const MAX_MARKERS_MOBILE = 250
const MAX_MARKERS_DESKTOP = 800
const DESKTOP_QUERY = '(min-width: 768px)'

/** Live desktop/mobile check so rotating or resizing re-caps without a reload. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY)
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', onChange)
    setIsDesktop(mq.matches)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}

const finite = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n)

type MapPoint = { id: string; lat: number; lng: number; p: Property }

// Where the user last panned/zoomed to — survives navigating into a property and back,
// so returning restores the exact spot instead of refitting to the whole extent.
const VIEWPORT_KEY = 'properties:mapViewport'

type Viewport = { lat: number; lng: number; zoom: number }

function savedViewport(): Viewport | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(VIEWPORT_KEY) ?? 'null')
    return v && finite(v.lat) && finite(v.lng) && finite(v.zoom) ? v : null
  } catch {
    return null
  }
}

/** Persist every pan/zoom so a remount (back-navigation) can restore it. */
function ViewportKeeper() {
  const map = useMapEvents({
    moveend: () => {
      const c = map.getCenter()
      sessionStorage.setItem(
        VIEWPORT_KEY,
        JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }),
      )
    },
  })
  return null
}

/**
 * Keep Leaflet's idea of its own size honest.
 *
 * Leaflet measures its container once and then only listens for window resizes, so a
 * container that changes size on its own — the sidebar collapsing, a phone rotating, or
 * the map painting its first frame while the panel around it is still laying out — leaves
 * it convinced it is the old size. That used to cost a few misplaced tiles. Now bounds
 * decide which properties load, so a stale size means an empty map.
 */
function SizeWatcher() {
  const map = useMap()
  useEffect(() => {
    // invalidateSize is a no-op when nothing changed, and fires moveend when it did —
    // which is exactly the signal the loader below is already waiting for.
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    // Belt and braces for the 0×0 wedge: an embedded/backgrounded webview can zero the
    // whole WINDOW (observed win=0x0 in the dev preview; phone tab restores behave the
    // same) and come back without the ResizeObserver firing. Everything computed while
    // zeroed — tile range, bounds listeners, pin visibility — is then stale, and
    // invalidateSize alone sees "no size change" and does nothing. So: a slow
    // heartbeat that, ONLY on the zero→visible transition, fires a real moveend to
    // make the tile layer and every bounds listener recompute.
    // While zeroed the webview FREEZES timers too, so the zero state can never be
    // observed directly — detect it by the gap it leaves: a heartbeat that skipped
    // ticks means we were frozen, and everything computed before the freeze is
    // suspect. One synthetic moveend makes the tile layer and every bounds listener
    // recompute; when nothing was actually wrong it costs a single re-render.
    const resync = () => {
      map.invalidateSize()
      map.fire('moveend')
    }
    let lastTick = Date.now()
    const raf = requestAnimationFrame(() => map.invalidateSize())
    const heartbeat = window.setInterval(() => {
      map.invalidateSize()
      const now = Date.now()
      if (now - lastTick > 5000) resync()
      lastTick = now
    }, 2000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') resync()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
      window.clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [map])
  return null
}

/**
 * A layer of its own for the parcel outlines, underneath the pins.
 *
 * Leaflet paints vectors in the order they were added, and the outlines are re-added on
 * every pan — so after the first reload the county's polygons sat ON TOP of the markers.
 * They are filled (faintly, but filled), so they took the clicks: a pin under a parcel
 * could not be opened, and clicking it produced the county's popup instead. A property
 * whose own outline is drawn is fine either way, because that outline carries its own
 * click through to the property; the ones this stranded were the ones with no outline of
 * their own to fall back on.
 *
 * Panes are the fix rather than DOM ordering, because ordering has to be re-won on every
 * reload while a pane holds. 350 sits above the tiles (200) and below the overlay pane
 * (400) where the markers live.
 */
const PARCEL_PANE = 'parcelOutlines'

/** Idempotent, and called during render so the pane exists before any layer names it. */
function ensureParcelPane(map: L.Map) {
  if (map.getPane(PARCEL_PANE)) return
  map.createPane(PARCEL_PANE).style.zIndex = '350'
}

/** Report the live viewport bounds so marker rendering — and loading — follow the camera. */
function BoundsWatcher({
  onBounds,
}: {
  onBounds: (b: L.LatLngBounds, zoom: number) => void
}) {
  const map = useMapEvents({
    moveend: () => onBounds(map.getBounds(), map.getZoom()),
    zoomend: () => onBounds(map.getBounds(), map.getZoom()),
  })
  useEffect(() => {
    onBounds(map.getBounds(), map.getZoom())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

/**
 * Refit the viewport whenever the plotted set changes (i.e. when filters change).
 * Suspended while a shape is active — refitting there would yank the map away from the
 * area the user drew. skipInitial suppresses the mount-time fit when restoring a
 * remembered viewport (coming back from a property page).
 */
function FitToPoints({
  points,
  suspended,
  skipInitial,
}: {
  points: MapPoint[]
  suspended?: boolean
  skipInitial?: boolean
}) {
  const map = useMap()
  const first = useRef(true)
  useEffect(() => {
    const isFirst = first.current
    first.current = false
    if (isFirst && skipInitial) return
    if (suspended || points.length === 0) return
    const bounds = L.latLngBounds(points.map((pt) => [pt.lat, pt.lng] as [number, number]))
    // How far apart the pins actually are decides how far to go in — not how many there are.
    // An assemblage is several parcels on one corner: three pins 30m apart at zoom 17 land on
    // top of each other and read as one property, which is the opposite of the point. A broad
    // set stays at 14, since zooming to street level on hundreds of pins hides most of them.
    const span = bounds.getNorthEast().distanceTo(bounds.getSouthWest())
    const maxZoom = span < 250 ? 19 : points.length <= 3 ? 17 : 14
    map.fitBounds(bounds, { padding: [30, 30], maxZoom })
  }, [points, map, suspended])
  return null
}

/**
 * In draw mode, each map click adds a vertex — and once the shape CAN close (3+
 * points), clicking back on the first point closes it (Alex: no Finish press).
 * Proximity is measured in SCREEN pixels, not degrees: a "did I hit the dot"
 * question is about the dot's rendered size, which doesn't change with zoom.
 */
const CLOSE_HIT_PX = 14

function ShapeDrawer({
  onVertex,
  closeTarget,
  onClose,
}: {
  onVertex: (lat: number, lng: number) => void
  /** The first vertex, present only once the draft is closable (3+ points). */
  closeTarget: LatLng | null
  onClose: () => void
}) {
  const map = useMapEvents({
    click: (e) => {
      if (closeTarget) {
        const hit = map
          .latLngToContainerPoint(e.latlng)
          .distanceTo(map.latLngToContainerPoint([closeTarget.lat, closeTarget.lng]))
        if (hit <= CLOSE_HIT_PX) {
          onClose()
          return
        }
      }
      onVertex(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

// ---------------------------------------------------------------------------
// Parcel outlines, straight from the county appraiser GIS services (same endpoints the
// enrichment functions use). Only at high zoom -- a viewport then holds a few hundred
// parcels at most. Clicking a parcel opens its CRM property when we hold that parcel,
// otherwise a popup with the county's own facts.
export const PARCEL_ZOOM = 16

type ParcelSvc = {
  name: string
  url: string
  /** rough county bounds [minLat, minLng, maxLat, maxLng] to skip irrelevant services */
  box: [number, number, number, number]
  fields: string[]
  attrs: (a: Record<string, unknown>) => { parcel: string; addr: string; owner: string; sf: string; acres: string }
}

const str0 = (v: unknown) => (v == null ? '' : String(v).trim())

const PARCEL_SERVICES: ParcelSvc[] = [
  {
    name: 'Hillsborough',
    url: 'https://maps.hillsboroughcounty.org/arcgis/rest/services/InfoLayers/HC_Parcels/FeatureServer/0',
    box: [27.57, -82.65, 28.2, -82.05],
    fields: ['PIN', 'SITE_ADDR', 'OWNER', 'HEAT_AR', 'ACREAGE'],
    attrs: (a) => ({ parcel: str0(a.PIN), addr: str0(a.SITE_ADDR), owner: str0(a.OWNER), sf: str0(a.HEAT_AR), acres: str0(a.ACREAGE) }),
  },
  {
    name: 'Pinellas',
    url: 'https://egis.pinellas.gov/pcpagis/rest/services/Pcpao_gov/PropertyPopup_A/MapServer/0',
    box: [27.6, -82.9, 28.2, -82.55],
    fields: ['DISPLAY_STRAP', 'SITE_ADDR', 'OWNER1', 'TOTAL_GROSS_SQFT', 'ACREAGE'],
    attrs: (a) => ({ parcel: str0(a.DISPLAY_STRAP), addr: str0(a.SITE_ADDR), owner: str0(a.OWNER1), sf: str0(a.TOTAL_GROSS_SQFT), acres: str0(a.ACREAGE) }),
  },
  {
    name: 'Sarasota',
    url: 'https://services3.arcgis.com/icrWMv7eBkctFu1f/arcgis/rest/services/ParcelHosted/FeatureServer/0',
    box: [26.9, -82.75, 27.4, -82.05],
    fields: ['ID', 'FULLADDRESS', 'NAME1', 'GRND_AREA', 'MeasuredAcreage'],
    attrs: (a) => ({ parcel: str0(a.ID), addr: str0(a.FULLADDRESS), owner: str0(a.NAME1), sf: str0(a.GRND_AREA), acres: str0(a.MeasuredAcreage) }),
  },
  {
    name: 'Pasco',
    url: 'https://pascogis.pascocountyfl.net/gisweb/rest/services/PascoView/PascoMapper_R_OP/MapServer/7',
    box: [28.15, -82.9, 28.5, -82.05],
    fields: ['VPARCEL', 'SITE_ADDRESS', 'OWNER_NAME_1', 'LIVING_AREA', 'SITE_ACRES'],
    attrs: (a) => ({ parcel: str0(a.VPARCEL), addr: str0(a.SITE_ADDRESS), owner: str0(a.OWNER_NAME_1), sf: str0(a.LIVING_AREA), acres: str0(a.SITE_ACRES) }),
  },
  {
    name: 'Manatee',
    url: 'https://gis.manateepao.com/arcgis/rest/services/Website/WebLayers/MapServer/0',
    box: [27.35, -82.75, 27.65, -82.05],
    fields: ['PARID', 'SITUS_ADDRESS', 'PAR_OWNER_NAME1', 'BLDGS_SQFT_LIVING', 'LAND_ACREAGE_CAMA'],
    attrs: (a) => ({ parcel: str0(a.PARID), addr: str0(a.SITUS_ADDRESS), owner: str0(a.PAR_OWNER_NAME1), sf: str0(a.BLDGS_SQFT_LIVING), acres: str0(a.LAND_ACREAGE_CAMA) }),
  },
  {
    name: 'Polk',
    url: 'https://gis.polk-county.net/server/rest/services/Map_Property_Appraiser/MapServer/1',
    box: [27.6, -82.11, 28.35, -81.1],
    fields: ['PARCELID', 'PROP_ADRNO', 'PROP_ADRSTR', 'PROP_ADRSUF', 'NAME', 'TOT_ACREAGE'],
    attrs: (a) => ({
      parcel: str0(a.PARCELID),
      addr: [str0(a.PROP_ADRNO), str0(a.PROP_ADRSTR), str0(a.PROP_ADRSUF)].filter(Boolean).join(' '),
      owner: str0(a.NAME), sf: '', acres: str0(a.TOT_ACREAGE),
    }),
  },
]

const PARCEL_STYLE = { color: '#ffffff', weight: 2, opacity: 0.8, fill: true, fillOpacity: 0.03 }
const PARCEL_STYLE_HOVER = { color: '#dc2626', weight: 3.5, opacity: 1, fillOpacity: 0.12 }

/**
 * A parcel we hold wears its property's pin colour instead of the generic white, so at
 * street level the outline carries the same meaning the dot did when zoomed out
 * (green/blue = verified owner, grey = not, etc). Heavier and more opaque than a
 * neighbouring county parcel so ours reads as "mine" at a glance.
 */
const parcelStyleFor = (color: string) => ({
  color,
  weight: 3,
  opacity: 1,
  fill: true,
  fillOpacity: 0.15,
  fillColor: color,
})

/** Format-blind parcel key: letters+digits only (folio digits vs dashed PIN both normalize). */
const parcelKey = (p: string | null | undefined) =>
  (p ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null

/**
 * Every parcel id a property carries — an assemblage carries several.
 *
 * 343 properties store more than one parcel in the single `parcel_number` field
 * ("24-28-27-000000-033001, 24-28-27-000000-033024, …"), because that is what they are:
 * one building over four lots. The county serves those lots one at a time, so a key built
 * from the whole field matches none of them — the outlines all render as somebody else's
 * land and the property is left relying on a dot that the outlines then cover.
 *
 * Splitting is what makes an assemblage clickable, and assemblages are exactly the
 * parcels worth clicking.
 */
const parcelKeys = (field: string | null | undefined): string[] =>
  (field ?? '')
    .split(/[,;\n]/)
    .map((part) => parcelKey(part))
    .filter((k): k is string => k != null)

function ParcelLines({
  parcelIndex,
  colorById,
  points,
  getHoverHtml,
  onMatchedIds,
  onOpenProperty,
}: {
  parcelIndex: Map<string, string>
  /** property id -> pin colour, so a held parcel outlines in its own colour */
  colorById: Map<string, string>
  /** CRM points for GEOMETRY matching: a stored parcel number that doesn't line up
   * with the county's key (20% of the book, the terse-address/format cases) used to
   * strand the property on a dot next to an anonymous white outline — but if our
   * point sits INSIDE a county polygon, that polygon IS the property. */
  points: { id: string; lat: number; lng: number }[]
  /** the same hover card the circles show — one generator, no drift */
  getHoverHtml: (id: string) => string
  /** reports which CRM properties now have an outline drawn, so the parent can drop their dots */
  onMatchedIds: (ids: Set<string>) => void
  onOpenProperty: (id: string) => void
}) {
  const [fc, setFc] = useState<{ type: 'FeatureCollection'; features: unknown[] } | null>(null)
  const [ver, setVer] = useState(0)
  const timer = useRef<number | null>(null)
  const seq = useRef(0)

  const map = useMapEvents({ moveend: schedule, zoomend: schedule })
  ensureParcelPane(map)
  // Re-run on mount AND whenever the matching inputs land: the first load usually
  // races the viewport fetch, so the geometry pass would otherwise run against an
  // empty point list and leave every held parcel white until the next pan.
  useEffect(() => {
    schedule()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, parcelIndex])

  function schedule() {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(load, 400)
  }

  async function load() {
    if (map.getZoom() < PARCEL_ZOOM) {
      setFc(null)
      onMatchedIds(new Set())
      return
    }
    const b = map.getBounds()
    const env = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`
    const my = ++seq.current
    const feats: any[] = []
    await Promise.all(
      PARCEL_SERVICES.filter(
        (s) => b.getSouth() <= s.box[2] && b.getNorth() >= s.box[0] &&
               b.getWest() <= s.box[3] && b.getEast() >= s.box[1],
      ).map(async (s) => {
        try {
          const u = `${s.url}/query?where=1%3D1&geometry=${encodeURIComponent(env)}` +
            `&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326` +
            `&spatialRel=esriSpatialRelIntersects&returnGeometry=true` +
            `&outFields=${encodeURIComponent(s.fields.join(','))}&resultRecordCount=600&f=geojson`
          const r = await fetch(u)
          const d = await r.json()
          if (Array.isArray(d?.features)) {
            for (const f of d.features) {
              f.properties = { ...(f.properties ?? {}), __svc: s.name }
              feats.push(f)
            }
          }
        } catch {
          // county service down or CORS-blocked -- its lines simply don't render
        }
      }),
    )
    if (my !== seq.current) return
    const kept = feats.slice(0, 2000)
    // Tell the parent which of our properties are now outlined, so it can drop their dots
    // and leave only the shape (the Regrid behaviour: dot far out, outline up close).
    // Derived from `kept`, not `feats` — a parcel trimmed by the cap has no outline drawn,
    // so its dot must stay or the property would vanish from the map entirely.
    //
    // TWO matching passes, both stamped onto the feature as `__crm`:
    // 1. parcel-key equality (authoritative);
    // 2. GEOMETRY — our point inside the county polygon. This is what turns the 20%
    //    of the book whose stored parcel number doesn't line up with the county's key
    //    from "a dot beside an anonymous white outline whose click shows county facts"
    //    into a coloured outline that opens the property (Alex: "I should just click
    //    right into the property").
    const matched = new Set<string>()
    for (const f of kept) {
      const svc = PARCEL_SERVICES.find((s) => s.name === f?.properties?.__svc)
      if (!svc) continue
      const k = parcelKey(svc.attrs(f.properties ?? {}).parcel)
      const id = k ? parcelIndex.get(k) : undefined
      if (id) {
        f.properties.__crm = id
        matched.add(id)
      }
    }
    let unclaimed = points.filter((pt) => !matched.has(pt.id))
    for (const f of kept) {
      if (f.properties.__crm || unclaimed.length === 0) continue
      const rings = outerRings(f.geometry)
      if (rings.length === 0) continue
      const [minLat, minLng, maxLat, maxLng] = ringsBbox(rings)
      for (const pt of unclaimed) {
        if (pt.lat < minLat || pt.lat > maxLat || pt.lng < minLng || pt.lng > maxLng) continue
        if (rings.some((ring) => pointInPolygon(ring, pt.lat, pt.lng))) {
          f.properties.__crm = pt.id
          matched.add(pt.id)
          unclaimed = unclaimed.filter((u) => u.id !== pt.id)
          break
        }
      }
    }
    setFc(kept.length ? { type: 'FeatureCollection', features: kept } : null)
    onMatchedIds(matched)
    setVer((v) => v + 1)
  }

  if (!fc) return null
  return (
    <GeoJSON
      key={ver}
      pane={PARCEL_PANE}
      data={fc as any}
      style={(feature: any) => {
        const id = feature?.properties?.__crm as string | undefined
        const color = id ? colorById.get(id) : undefined
        return color ? parcelStyleFor(color) : PARCEL_STYLE
      }}
      onEachFeature={(feature: any, layer: any) => {
        const svc = PARCEL_SERVICES.find((s) => s.name === feature?.properties?.__svc)
        if (!svc) return
        const a = svc.attrs(feature.properties ?? {})
        const crmId = feature?.properties?.__crm as string | undefined
        // Remember this parcel's own resting style — mouseout must restore ITS colour,
        // not the generic white, or hovering a held parcel would permanently bleach it.
        const ownColor = crmId ? colorById.get(crmId) : undefined
        const base = ownColor ? parcelStyleFor(ownColor) : PARCEL_STYLE
        // hover: light the parcel up red and heavier so the cursor's target is unmistakable
        layer.on('mouseover', () => layer.setStyle(PARCEL_STYLE_HOVER))
        layer.on('mouseout', () => layer.setStyle(base))
        if (crmId) {
          // a parcel we hold: click opens the property, hover shows the SAME card the
          // circles show — the outline IS the property now
          layer.on('click', () => onOpenProperty(crmId))
          layer.bindTooltip(() => getHoverHtml(crmId), { sticky: true })
        } else {
          const rows = [
            a.addr && `<b>${a.addr}</b>`,
            a.owner && `Owner: ${a.owner}`,
            a.sf && `${Number(a.sf).toLocaleString()} SF`,
            a.acres && `${a.acres} AC`,
            a.parcel && `<span style="opacity:.6">${a.parcel}</span>`,
          ].filter(Boolean)
          layer.bindPopup(rows.join('<br>') || 'No county data')
        }
      }}
    />
  )
}

/** The outer ring(s) of a GeoJSON Polygon/MultiPolygon as {lat,lng} lists (holes ignored
 * — a point in a courtyard still belongs to the parcel for our purposes). */
function outerRings(geometry: Geometry | null | undefined): LatLng[][] {
  if (!geometry) return []
  const toRing = (ring: number[][]) => ring.map(([lng, lat]) => ({ lat, lng }))
  if (geometry.type === 'Polygon') {
    return geometry.coordinates[0] ? [toRing(geometry.coordinates[0])] : []
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .map((poly) => poly[0])
      .filter((ring): ring is number[][] => ring != null)
      .map(toRing)
  }
  return []
}

function ringsBbox(rings: LatLng[][]): [number, number, number, number] {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity
  for (const ring of rings) {
    for (const v of ring) {
      if (v.lat < minLat) minLat = v.lat
      if (v.lat > maxLat) maxLat = v.lat
      if (v.lng < minLng) minLng = v.lng
      if (v.lng > maxLng) maxLng = v.lng
    }
  }
  return [minLat, minLng, maxLat, maxLng]
}

/**
 * Interactive map of the (filtered) properties: pan/zoom, hover a pin for a quick card,
 * click it to open the detail page. Only properties with stored coordinates appear.
 *
 * ONE colour scheme: gold = executed under us, BLUE = we can reach the owner today
 * (phone- or email-verified — Alex 2026-08-16: "verified contacts should be blue
 * still"), green = on market, slate = off market. Executed outranks verified outranks
 * market status. Red belongs to the industrial overlay, not to pins.
 */
const PIN = {
  executed: '#f59e0b',
  verified: '#2563eb',
  on: '#059669',
  off: '#64748b',
} as const

const LEGEND: { c: string; label: string }[] = [
  { c: PIN.on, label: 'On market' },
  { c: PIN.off, label: 'Off market' },
  { c: PIN.verified, label: 'Verified owner' },
  { c: PIN.executed, label: 'Executed' },
]

/**
 * ONE hover card for both marker shapes. The circles and the parcel outlines used to
 * show different information (the outline's click even opened a county-facts popup) —
 * "which is bad" (Alex). Everything renders from this generator now: the circle's
 * Tooltip and the held-parcel outline's sticky tooltip can never drift apart.
 * Returns an HTML string because Leaflet's imperative bindTooltip needs one; the JSX
 * side injects it verbatim.
 */
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function hoverCardHtml(
  p: Property,
  opts: {
    ctx?: OwnerContext
    ask?: CurrentAsking
    lease?: LeaseComp
    executed?: boolean
    goodDeal?: boolean
    industrialCrossovers?: Set<string>
  },
): string {
  const { ctx, ask, lease, executed, goodDeal, industrialCrossovers } = opts
  const off = p.listing_status === 'off_market'
  const loc = [p.city, p.state].filter(Boolean).join(', ')
  const askLabel = formatPsf(ask?.rate) ?? formatCurrency(ask?.price)
  const bits = [
    askLabel,
    p.property_type ? propertyKindLabels[p.property_type] : null,
    formatSf(p.gross_sf),
    p.land_acres != null ? `${p.land_acres} AC` : null,
    executed ? 'Executed' : off ? 'Off market' : 'On market',
    goodDeal ? 'Good deal' : null,
    // the hover answers "what can I do with the dirt" without a click
    p.zoning_code
      ? `Zoned ${p.zoning_code}${isZonedIndustrial(p, industrialCrossovers) ? ' (ind ok)' : ''}`
      : null,
  ].filter(Boolean) as string[]

  const rows: string[] = [`<div class="font-medium">${esc(p.address ?? '')}</div>`]
  if (loc) rows.push(`<div class="opacity-70">${esc(loc)}</div>`)
  if (bits.length) rows.push(`<div class="opacity-70">${esc(bits.join(' · '))}</div>`)
  if (lease) {
    const l: string[] = [
      `<div class="font-medium">${esc(lease.tenant_name || 'Tenant not named')}</div>`,
      ...leaseLines(lease).map((line) => `<div class="opacity-70">${esc(line)}</div>`),
    ]
    if (lease.dm_name) {
      // The person, not just the building: hover answers "who do I call".
      l.push(
        `<div class="${lease.dm_verified ? 'font-medium text-blue-700' : 'opacity-70'}">${
          lease.dm_verified ? 'DM &#10003; ' : 'DM? '
        }${esc(lease.dm_name)}${lease.dm_phone ? ` · ${esc(lease.dm_phone)}` : ''}</div>`,
      )
    }
    rows.push(`<div class="mt-1 border-t pt-1">${l.join('')}</div>`)
  }
  if (ctx?.owner_name) {
    const portfolio = ctx.owner_property_count ?? 0
    const o: string[] = [
      `<div class="font-medium">${esc(ctx.owner_name)}</div>`,
      `<div class="opacity-70">${
        ctx.owner_contact_verified
          ? 'Verified contact'
          : (ctx.owner_contact_count ?? 0) > 0
            ? `${ctx.owner_contact_count} contact${ctx.owner_contact_count === 1 ? '' : 's'}, unverified`
            : 'No contact yet'
      }${portfolio > 1 ? ` · ${portfolio} properties` : ''}</div>`,
    ]
    if ((ctx.comm_count ?? 0) > 0) {
      o.push(`<div class="opacity-70">${ctx.comm_count} conversation${ctx.comm_count === 1 ? '' : 's'}</div>`)
    }
    if (ctx.owner_do_not_call) o.push(`<div class="font-medium text-red-600">Do not call</div>`)
    rows.push(`<div class="mt-1 border-t pt-1">${o.join('')}</div>`)
  }
  return `<div class="max-w-[15rem] text-xs leading-snug">${rows.join('')}</div>`
}

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

/**
 * Monthly rent implied by the comp: annual PSF x area / 12.
 *
 * Whether that is the whole cheque depends on the structure, which is why the caller
 * prints it alongside — on a gross lease this is what the tenant pays, on NNN it is
 * base rent before taxes, insurance and CAM, and the book does not carry those.
 */
function monthlyRent(l: LeaseComp): number | null {
  const psf = l.executed_lease_rate_psf
  if (psf == null || !l.sf) return null
  return (Number(psf) * l.sf) / 12
}

/** Terms of the representative lease, for the hover card on the lease lens. */
function leaseLines(l: LeaseComp): string[] {
  const lines: string[] = []
  const dates: string[] = []
  if (l.signed_date) dates.push(`Signed ${shortDate(l.signed_date)}`)
  if (l.expiration_date) {
    const m = l.months_to_expiry
    // 0 is floored months, i.e. "under a month out" — not "this calendar month".
    const rel = m == null ? '' : m < 0 ? ' (expired)' : m === 0 ? ' (<1 mo)' : ` (${m} mo)`
    dates.push(`expires ${shortDate(l.expiration_date)}${rel}`)
  }
  if (dates.length) lines.push(dates.join(' · '))

  const terms: string[] = []
  if (l.executed_lease_rate_psf != null) {
    terms.push(`${formatPsf(l.executed_lease_rate_psf)}${l.lease_structure ? ` ${l.lease_structure}` : ''}`)
  }
  if (l.sf) terms.push(`${l.sf.toLocaleString()} SF`)
  const rent = monthlyRent(l)
  if (rent != null) terms.push(`${formatCurrency(Math.round(rent))}/mo`)
  if (terms.length) lines.push(terms.join(' · '))
  return lines
}

export function PropertiesMap({
  properties,
  parcelProperties,
  emptyHint,
  goodDealIds,
  executedIds,
  ownerContext,
  leaseInfo,
  polygon,
  draft,
  drawMode = false,
  onAddVertex,
  onFinishShape,
  asking,
  industrialCrossovers,
  onViewportChange,
  totalInView,
  overlays,
}: {
  properties: Property[]
  /**
   * Source for parcel-outline matching/colouring at street level. Pins plot only from
   * `properties`, but held-parcel recognition should span the whole book even when no
   * pins are requested (the no-preload map) — so the parent passes the full set here.
   */
  parcelProperties?: Property[]
  /** Header text when there are no pins to plot (loading / no search yet / no matches). */
  emptyHint?: string
  goodDealIds?: Set<string>
  executedIds?: Set<string>
  ownerContext?: Map<string, OwnerContext>
  /**
   * Property id -> its representative lease, for the hover card. The parent passes it
   * only while a lease filter is narrowing the set — that is when "who is leaving and
   * when" is the question being asked of the map.
   */
  leaseInfo?: Map<string, LeaseComp>
  /** Completed search shape; the parent owns it because it also filters the table + export. */
  polygon?: LatLng[] | null
  /** Vertices of a shape mid-draw (draw mode active while non-null). */
  draft?: LatLng[] | null
  drawMode?: boolean
  onAddVertex?: (lat: number, lng: number) => void
  /** Fired when the drawer clicks back on the first vertex of a closable draft. */
  onFinishShape?: () => void
  /** Current asking per property, so a listed pin can show its rate/price on hover. */
  asking?: Map<string, CurrentAsking>
  /** Crossover zoning codes (jurisdiction|code) that allow industrial without being it. */
  industrialCrossovers?: Set<string>
  /**
   * Fires with the camera's bounds on every settled pan/zoom. The parent uses it to load
   * only the properties on screen — the map asks for what the user is looking at rather
   * than being handed the whole book up front.
   */
  onViewportChange?: (
    view: { south: number; west: number; north: number; east: number; zoom: number },
  ) => void
  /**
   * How many properties the viewport actually holds when `properties` is a capped slice
   * of it. Lets the header say "1,200 of 3,386 here" instead of implying that what
   * arrived is all there is.
   */
  totalInView?: number
  /** Which zoning/lowlands overlays paint (whole districts under the pins). */
  overlays?: OverlayState
}) {
  const navigate = useNavigate()
  // read once per mount: restoring the exact spot the user left when they clicked a pin
  const [initialView] = useState<Viewport | null>(savedViewport)
  const parcelSource = parcelProperties ?? properties
  // parcel-number -> property id (format-blind), for click-through from parcel outlines
  const parcelIndex = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of parcelSource) {
      // every lot of an assemblage points back at the one property
      for (const k of parcelKeys(p.parcel_number)) m.set(k, p.id)
    }
    return m
  }, [parcelSource])

  // Executed wins (a closed deal is usually off-market too), then verified-owner blue.
  const colorOf = useCallback(
    (id: string, p: Property) =>
      executedIds?.has(id)
        ? PIN.executed
        : ownerContext?.get(id)?.owner_reachable
          ? PIN.verified
          : p.listing_status === 'off_market'
            ? PIN.off
            : PIN.on,
    [executedIds, ownerContext],
  )

  // Same colour the dot would have used, keyed by property, so the parcel outline can
  // inherit it at street level.
  const pinColorById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of parcelSource) m.set(p.id, colorOf(p.id, p))
    return m
  }, [parcelSource, colorOf])

  // Everything the outline's hover card needs, by property id — the outlines show the
  // SAME card the circles do.
  const parcelById = useMemo(() => {
    const m = new Map<string, Property>()
    for (const p of parcelSource) m.set(p.id, p)
    return m
  }, [parcelSource])
  const getHoverHtml = useCallback(
    (id: string) => {
      const p = parcelById.get(id)
      if (!p) return ''
      return hoverCardHtml(p, {
        ctx: ownerContext?.get(id),
        ask: asking?.get(id),
        lease: leaseInfo?.get(id),
        executed: executedIds?.has(id),
        goodDeal: goodDealIds?.has(id),
        industrialCrossovers,
      })
    },
    [parcelById, ownerContext, asking, leaseInfo, executedIds, goodDealIds, industrialCrossovers],
  )
  // Light coordinate list for the geometry-matching pass.
  const parcelPoints = useMemo(
    () =>
      parcelSource
        .filter((p) => finite(p.lat) && finite(p.lng))
        .map((p) => ({ id: p.id, lat: p.lat as number, lng: p.lng as number })),
    [parcelSource],
  )

  // Properties whose parcel outline is currently drawn — their dot is suppressed so the
  // shape stands alone, and comes back the moment you zoom out past PARCEL_ZOOM.
  const [outlinedIds, setOutlinedIds] = useState<Set<string>>(() => new Set())
  // Parcels reload on every pan/zoom, but panning within one block usually yields the
  // same set. Swap state only on a real change, or each pan would re-render every marker.
  const applyOutlined = useCallback((next: Set<string>) => {
    setOutlinedIds((cur) => {
      if (cur.size === next.size && [...next].every((id) => cur.has(id))) return cur
      return next
    })
  }, [])

  const points = useMemo<MapPoint[]>(
    () =>
      properties
        .filter((p) => finite(p.lat) && finite(p.lng))
        .map((p) => ({ id: p.id, lat: p.lat as number, lng: p.lng as number, p })),
    [properties],
  )
  const maxMarkers = useIsDesktop() ? MAX_MARKERS_DESKTOP : MAX_MARKERS_MOBILE
  // Regrid-style rendering: the cap applies to what's IN VIEW, not to the whole book.
  // Pan or zoom and the markers around you (re)load — every property in a street-level
  // viewport gets its pin, while a whole-region view stays capped for performance.
  const [viewBounds, setViewBounds] = useState<L.LatLngBounds | null>(null)
  const onBounds = useCallback(
    (b: L.LatLngBounds, zoom: number) => {
      setViewBounds(b)
      onViewportChange?.({
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
        // the parent needs this to know when parcel outlines are in play, and therefore
        // when it has to tell the map about every property on screen, not just the matches
        zoom,
      })
    },
    [onViewportChange],
  )
  const shown = useMemo(() => {
    if (!viewBounds) return points.slice(0, maxMarkers)
    const padded = viewBounds.pad(0.2)
    const inView: MapPoint[] = []
    for (const pt of points) {
      if (padded.contains([pt.lat, pt.lng] as [number, number])) {
        inView.push(pt)
        if (inView.length >= maxMarkers) break
      }
    }
    return inView
  }, [points, maxMarkers, viewBounds])

  // What the line above the map says. `totalInView` is present only when the parent is
  // loading by viewport, and then it — not the size of the slice that arrived — is the
  // honest denominator: "1,200 of 3,386 here" rather than a quiet truncation.
  const num = (n: number) => n.toLocaleString()
  const headline =
    points.length === 0
      ? emptyHint ??
        'None of these properties have map coordinates yet — add a parcel/address so they can be located.'
      : totalInView != null
        ? shown.length < totalInView
          ? `${num(shown.length)} of ${num(totalInView)} properties here — zoom in to see the rest · click a pin to open`
          : `${num(shown.length)} in view · click a pin to open · zoom in for parcel lines.`
        : shown.length >= maxMarkers
          ? `Showing the ${num(shown.length)} nearest of ${num(points.length)} mapped — zoom in and every property in view gets a pin.`
          : `${num(shown.length)} in view of ${num(points.length)} mapped · click a pin to open · zoom in for parcel lines.`

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-xs text-muted-foreground">{headline}</p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {LEGEND.map(({ c, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-full ring-1 ring-white"
                style={{ backgroundColor: c }}
              />
              {label}
            </span>
          ))}
        </div>
      </div>
      {/* isolate z-0 keeps Leaflet's internal z-indexes from covering app dialogs/popovers */}
      <div className="relative isolate z-0 h-[70vh] w-full overflow-hidden rounded-lg border">
        <MapContainer
          center={initialView ? [initialView.lat, initialView.lng] : [27.95, -82.5]}
          zoom={initialView?.zoom ?? 8}
          scrollWheelZoom
          className="size-full"
          style={{ background: '#f8fafc' }}
        >
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />
          <SizeWatcher />
          <ViewportKeeper />
          {overlays && <MapOverlays state={overlays} />}
          <ParcelLines
            parcelIndex={parcelIndex}
            colorById={pinColorById}
            points={parcelPoints}
            getHoverHtml={getHoverHtml}
            onMatchedIds={applyOutlined}
            onOpenProperty={(pid) => navigate(`/properties/${pid}`)}
          />
          <BoundsWatcher onBounds={onBounds} />
          {/* `totalInView` present means the parent is loading by viewport: the camera is
              driving the data, so the data must not drive the camera back. */}
          <FitToPoints
            points={points}
            suspended={drawMode || !!polygon || totalInView != null}
            skipInitial={!!initialView}
          />
          {drawMode && onAddVertex && (
            <ShapeDrawer
              onVertex={onAddVertex}
              closeTarget={draft && draft.length >= 3 ? draft[0] : null}
              onClose={() => onFinishShape?.()}
            />
          )}
          {/* the completed search shape */}
          {polygon && polygon.length >= 3 && (
            <Polygon
              positions={polygon.map((v) => [v.lat, v.lng] as [number, number])}
              pathOptions={{
                color: '#2563eb',
                weight: 2,
                fillColor: '#2563eb',
                fillOpacity: 0.08,
              }}
              interactive={false}
            />
          )}
          {/* the shape mid-draw: open polyline + a dot per vertex */}
          {draft && draft.length > 0 && (
            <>
              <Polyline
                positions={draft.map((v) => [v.lat, v.lng] as [number, number])}
                pathOptions={{ color: '#2563eb', weight: 2, dashArray: '6 4' }}
                interactive={false}
              />
              {draft.map((v, i) => {
                // Once the shape can close, the first vertex grows into a visible
                // target — clicking it is now how the shape concludes.
                const isCloseTarget = i === 0 && draft.length >= 3
                return (
                  <CircleMarker
                    key={`draft-${i}`}
                    center={[v.lat, v.lng]}
                    radius={isCloseTarget ? 8 : 4}
                    pathOptions={{
                      color: '#2563eb',
                      weight: isCloseTarget ? 3 : 2,
                      fillColor: '#fff',
                      fillOpacity: 1,
                    }}
                    interactive={false}
                  />
                )
              })}
            </>
          )}
          {shown.map(({ id, lat, lng, p }) => {
            // Zoomed in far enough that this property's parcel outline is drawn: the
            // outline IS the marker now, so skip the dot rather than stack both.
            if (outlinedIds.has(id)) return null
            const fillColor = colorOf(id, p)
            return (
              <CircleMarker
                key={id}
                center={[lat, lng]}
                radius={7}
                pathOptions={{ color: '#fff', weight: 1.5, fillColor, fillOpacity: 0.9 }}
                // while drawing, a click near a pin should add a vertex (the event bubbles
                // to the map), not navigate away mid-shape
                eventHandlers={{ click: () => { if (!drawMode) navigate(`/properties/${id}`) } }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  {/* the ONE hover card — same generator the parcel outlines use */}
                  <div dangerouslySetInnerHTML={{ __html: getHoverHtml(id) }} />
                </Tooltip>
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>
    </div>
  )
}
