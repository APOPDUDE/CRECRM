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
import type { LatLng } from '@/lib/geo'

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

/** Report the live viewport bounds so marker rendering can follow the camera. */
function BoundsWatcher({ onBounds }: { onBounds: (b: L.LatLngBounds) => void }) {
  const map = useMapEvents({
    moveend: () => onBounds(map.getBounds()),
    zoomend: () => onBounds(map.getBounds()),
  })
  useEffect(() => {
    onBounds(map.getBounds())
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
    // Narrowing to a handful of properties means the user searched for a specific one, so go in
    // far enough that the county parcel outlines (zoom >= 16) draw. A broad set stays at 14 —
    // zooming to street level on hundreds of pins would just hide most of them.
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: points.length <= 3 ? 17 : 14 })
  }, [points, map, suspended])
  return null
}

/** In draw mode, each map click adds a vertex to the shape being drawn. */
function ShapeDrawer({ onVertex }: { onVertex: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => onVertex(e.latlng.lat, e.latlng.lng),
  })
  return null
}

// ---------------------------------------------------------------------------
// Parcel outlines, straight from the county appraiser GIS services (same endpoints the
// enrichment functions use). Only at high zoom -- a viewport then holds a few hundred
// parcels at most. Clicking a parcel opens its CRM property when we hold that parcel,
// otherwise a popup with the county's own facts.
const PARCEL_ZOOM = 16

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

function ParcelLines({
  parcelIndex,
  colorById,
  onMatchedIds,
  onOpenProperty,
}: {
  parcelIndex: Map<string, string>
  /** property id -> pin colour, so a held parcel outlines in its own colour */
  colorById: Map<string, string>
  /** reports which CRM properties now have an outline drawn, so the parent can drop their dots */
  onMatchedIds: (ids: Set<string>) => void
  onOpenProperty: (id: string) => void
}) {
  const [fc, setFc] = useState<{ type: 'FeatureCollection'; features: unknown[] } | null>(null)
  const [ver, setVer] = useState(0)
  const timer = useRef<number | null>(null)
  const seq = useRef(0)

  const map = useMapEvents({ moveend: schedule, zoomend: schedule })
  useEffect(() => {
    schedule()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    const matched = new Set<string>()
    for (const f of kept) {
      const svc = PARCEL_SERVICES.find((s) => s.name === f?.properties?.__svc)
      if (!svc) continue
      const k = parcelKey(svc.attrs(f.properties ?? {}).parcel)
      const id = k ? parcelIndex.get(k) : undefined
      if (id) matched.add(id)
    }
    setFc(kept.length ? { type: 'FeatureCollection', features: kept } : null)
    onMatchedIds(matched)
    setVer((v) => v + 1)
  }

  if (!fc) return null
  return (
    <GeoJSON
      key={ver}
      data={fc as any}
      style={(feature: any) => {
        const svc = PARCEL_SERVICES.find((s) => s.name === feature?.properties?.__svc)
        if (!svc) return PARCEL_STYLE
        const k = parcelKey(svc.attrs(feature.properties ?? {}).parcel)
        const id = k ? parcelIndex.get(k) : undefined
        const color = id ? colorById.get(id) : undefined
        return color ? parcelStyleFor(color) : PARCEL_STYLE
      }}
      onEachFeature={(feature: any, layer: any) => {
        const svc = PARCEL_SERVICES.find((s) => s.name === feature?.properties?.__svc)
        if (!svc) return
        const a = svc.attrs(feature.properties ?? {})
        const crmId = parcelKey(a.parcel) ? parcelIndex.get(parcelKey(a.parcel)!) : undefined
        // Remember this parcel's own resting style — mouseout must restore ITS colour,
        // not the generic white, or hovering a held parcel would permanently bleach it.
        const ownColor = crmId ? colorById.get(crmId) : undefined
        const base = ownColor ? parcelStyleFor(ownColor) : PARCEL_STYLE
        // hover: light the parcel up red and heavier so the cursor's target is unmistakable
        layer.on('mouseover', () => layer.setStyle(PARCEL_STYLE_HOVER))
        layer.on('mouseout', () => layer.setStyle(base))
        if (crmId) {
          // a parcel we hold: click goes straight to the property page
          layer.on('click', () => onOpenProperty(crmId))
          layer.bindTooltip(`${a.addr || a.parcel} — open in CRM`, { sticky: true })
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

/**
 * Interactive map of the (filtered) properties: pan/zoom, hover a pin for a quick card,
 * click it to open the detail page. Only properties with stored coordinates appear.
 * Pin colour says one thing — where the property stands with us:
 * gold = executed under us (wins, and they'd otherwise read as off-market),
 * green = on market, red = off market. Good deals are called out in the tooltip.
 */
const PIN = {
  executed: '#f59e0b',
  on: '#059669',
  off: '#dc2626',
} as const

/**
 * The owner lens answers ONE question: do we hold a verified owner contact or not.
 * Deliberately binary (Alex 2026-08-01) — a county-record owner name or an unverified
 * skip-trace number doesn't change the workflow, because Terrakotta only needs the
 * address to skip-trace. Either we can call the owner today, or the parcel belongs on
 * the next skip-trace export.
 */
const OWNER_PIN = {
  verified: '#2563eb',
  // Reachable by EMAIL only — a reply came back, but nobody has had a conversation.
  // Its own colour rather than folding into verified: both are "worth contacting", but
  // one you can call today and the other you can only write to, and the map should not
  // blur that into a single dot.
  emailOnly: '#0d9488',
  unverified: '#94a3b8',
} as const

/**
 * The lease lens answers "how soon does this building come available".
 *
 * That is a magnitude, not a set of categories, so it gets a sequential ramp: one hue,
 * dark for imminent through pale for distant, with a neutral for leases running past
 * the year. Reading it needs no legend lookup — darker simply means sooner.
 */
const LEASE_PIN = {
  m1: '#7f1d1d',
  m3: '#b91c1c',
  m6: '#ef4444',
  m12: '#fca5a5',
  beyond: '#94a3b8',
  // Off the ramp on purpose: an expired lease is not "further along the same scale",
  // it is a different state — a past comp rather than upcoming availability.
  expired: '#475569',
} as const

export type MapColorBy = 'market' | 'owner' | 'lease'

function ownerPin(ctx: OwnerContext | undefined): string {
  if (ctx?.owner_contact_verified) return OWNER_PIN.verified
  if (ctx?.owner_email_verified) return OWNER_PIN.emailOnly
  return OWNER_PIN.unverified
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

/** Months to the representative lease's expiry -> its step on the ramp. */
function leasePin(months: number | undefined): string {
  if (months == null) return LEASE_PIN.beyond
  if (months < 0) return LEASE_PIN.expired
  if (months < 1) return LEASE_PIN.m1
  if (months < 3) return LEASE_PIN.m3
  if (months < 6) return LEASE_PIN.m6
  if (months < 12) return LEASE_PIN.m12
  return LEASE_PIN.beyond
}

const LEGENDS: Record<MapColorBy, { c: string; label: string }[]> = {
  market: [
    { c: PIN.on, label: 'On market' },
    { c: PIN.off, label: 'Off market' },
    { c: PIN.executed, label: 'Executed' },
  ],
  owner: [
    { c: OWNER_PIN.verified, label: 'Spoken to — number confirmed' },
    { c: OWNER_PIN.emailOnly, label: 'Email only — no call yet' },
    { c: OWNER_PIN.unverified, label: 'Not verified' },
  ],
  lease: [
    { c: LEASE_PIN.expired, label: 'Expired' },
    { c: LEASE_PIN.m1, label: '< 1 mo' },
    { c: LEASE_PIN.m3, label: '1-3 mo' },
    { c: LEASE_PIN.m6, label: '3-6 mo' },
    { c: LEASE_PIN.m12, label: '6-12 mo' },
    { c: LEASE_PIN.beyond, label: '1 yr+' },
  ],
}

export function PropertiesMap({
  properties,
  parcelProperties,
  emptyHint,
  goodDealIds,
  executedIds,
  ownerContext,
  colorBy = 'market',
  leaseInfo,
  polygon,
  draft,
  drawMode = false,
  onAddVertex,
  asking,
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
  colorBy?: MapColorBy
  /**
   * Property id -> its soonest still-running lease. Colours the pin on the lease lens and
   * names the outgoing tenant on hover. The parent owns the windowing, because the same
   * filter drives the table.
   */
  leaseInfo?: Map<string, LeaseComp>
  /** Completed search shape; the parent owns it because it also filters the table + export. */
  polygon?: LatLng[] | null
  /** Vertices of a shape mid-draw (draw mode active while non-null). */
  draft?: LatLng[] | null
  drawMode?: boolean
  onAddVertex?: (lat: number, lng: number) => void
  /** Current asking per property, so a listed pin can show its rate/price on hover. */
  asking?: Map<string, CurrentAsking>
}) {
  const navigate = useNavigate()
  // read once per mount: restoring the exact spot the user left when they clicked a pin
  const [initialView] = useState<Viewport | null>(savedViewport)
  const parcelSource = parcelProperties ?? properties
  // parcel-number -> property id (format-blind), for click-through from parcel outlines
  const parcelIndex = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of parcelSource) {
      const k = parcelKey(p.parcel_number)
      if (k) m.set(k, p.id)
    }
    return m
  }, [parcelSource])

  // Executed wins over market status — a closed deal is usually off-market too.
  const colorOf = useCallback(
    (id: string, p: Property) =>
      colorBy === 'lease'
        ? leasePin(leaseInfo?.get(id)?.months_to_expiry ?? undefined)
        : colorBy === 'owner'
          ? ownerPin(ownerContext?.get(id))
          : executedIds?.has(id)
            ? PIN.executed
            : p.listing_status === 'off_market'
              ? PIN.off
              : PIN.on,
    [colorBy, ownerContext, executedIds, leaseInfo],
  )

  // Same colour the dot would have used, keyed by property, so the parcel outline can
  // inherit it at street level.
  const pinColorById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of parcelSource) m.set(p.id, colorOf(p.id, p))
    return m
  }, [parcelSource, colorOf])

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

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-xs text-muted-foreground">
          {points.length === 0
            ? emptyHint ??
              'None of these properties have map coordinates yet — add a parcel/address so they can be located.'
            : shown.length >= maxMarkers
              ? `Showing the ${shown.length} nearest of ${points.length} mapped — zoom in and every property in view gets a pin.`
              : `${shown.length} in view of ${points.length} mapped · click a pin to open · zoom in for parcel lines.`}
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {LEGENDS[colorBy].map(({ c, label }) => (
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
          <ViewportKeeper />
          <ParcelLines
            parcelIndex={parcelIndex}
            colorById={pinColorById}
            onMatchedIds={applyOutlined}
            onOpenProperty={(pid) => navigate(`/properties/${pid}`)}
          />
          <BoundsWatcher onBounds={setViewBounds} />
          <FitToPoints points={points} suspended={drawMode || !!polygon} skipInitial={!!initialView} />
          {drawMode && onAddVertex && <ShapeDrawer onVertex={onAddVertex} />}
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
              {draft.map((v, i) => (
                <CircleMarker
                  key={`draft-${i}`}
                  center={[v.lat, v.lng]}
                  radius={4}
                  pathOptions={{ color: '#2563eb', weight: 2, fillColor: '#fff', fillOpacity: 1 }}
                  interactive={false}
                />
              ))}
            </>
          )}
          {shown.map(({ id, lat, lng, p }) => {
            // Zoomed in far enough that this property's parcel outline is drawn: the
            // outline IS the marker now, so skip the dot rather than stack both.
            if (outlinedIds.has(id)) return null
            const executed = executedIds?.has(id)
            const off = p.listing_status === 'off_market'
            const ctx = ownerContext?.get(id)
            const fillColor = colorOf(id, p)
            const loc = [p.city, p.state].filter(Boolean).join(', ')
            const ask = asking?.get(id)
            const askLabel = formatPsf(ask?.rate) ?? formatCurrency(ask?.price)
            const bits = [
              askLabel,
              p.property_type ? propertyKindLabels[p.property_type] : null,
              formatSf(p.building_sf),
              p.land_acres != null ? `${p.land_acres} AC` : null,
              executed ? 'Executed' : off ? 'Off market' : 'On market',
              goodDealIds?.has(id) ? 'Good deal' : null,
            ].filter(Boolean)
            const portfolio = ctx?.owner_property_count ?? 0
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
                  <div className="max-w-[15rem] text-xs leading-snug">
                    <div className="font-medium">{p.address}</div>
                    {loc && <div className="opacity-70">{loc}</div>}
                    {bits.length > 0 && <div className="opacity-70">{bits.join(' · ')}</div>}
                    {colorBy === 'lease' && leaseInfo?.get(id) && (
                      <div className="mt-1 border-t pt-1">
                        <div className="font-medium">
                          {leaseInfo.get(id)!.tenant_name || 'Tenant not named'}
                        </div>
                        {leaseLines(leaseInfo.get(id)!).map((line) => (
                          <div key={line} className="opacity-70">
                            {line}
                          </div>
                        ))}
                        {/* The person, not just the building: hover answers "who do I
                            call" without leaving the map. */}
                        {leaseInfo.get(id)!.dm_name && (
                          <div
                            className={
                              leaseInfo.get(id)!.dm_verified ? 'font-medium text-blue-700' : 'opacity-70'
                            }
                          >
                            {leaseInfo.get(id)!.dm_verified ? 'DM ✓ ' : 'DM? '}
                            {leaseInfo.get(id)!.dm_name}
                            {leaseInfo.get(id)!.dm_phone ? ` · ${leaseInfo.get(id)!.dm_phone}` : ''}
                          </div>
                        )}
                      </div>
                    )}
                    {ctx?.owner_name && (
                      <div className="mt-1 border-t pt-1">
                        <div className="font-medium">{ctx.owner_name}</div>
                        <div className="opacity-70">
                          {ctx.owner_contact_verified
                            ? 'Verified contact'
                            : (ctx.owner_contact_count ?? 0) > 0
                              ? `${ctx.owner_contact_count} contact${ctx.owner_contact_count === 1 ? '' : 's'}, unverified`
                              : 'No contact yet'}
                          {portfolio > 1 ? ` · ${portfolio} properties` : ''}
                        </div>
                        {(ctx.comm_count ?? 0) > 0 && (
                          <div className="opacity-70">
                            {ctx.comm_count} conversation{ctx.comm_count === 1 ? '' : 's'}
                          </div>
                        )}
                        {ctx.owner_do_not_call && (
                          <div className="font-medium text-red-600">Do not call</div>
                        )}
                      </div>
                    )}
                  </div>
                </Tooltip>
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>
    </div>
  )
}
