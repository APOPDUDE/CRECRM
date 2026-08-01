import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { propertyKindLabels } from '@/components/property-form-dialog'
import type { Property } from '@/hooks/use-properties'
import type { OwnerContext } from '@/hooks/use-owners'
import { formatSf } from '@/lib/format'
import type { LatLng } from '@/lib/geo'

// CircleMarkers are cheap (SVG), but each mounts a hover Tooltip, so a few hundred is
// the comfortable ceiling on a phone. Desktop has the headroom for the whole book, so
// the cap is viewport-dependent rather than a single conservative number.
const MAX_MARKERS_MOBILE = 400
const MAX_MARKERS_DESKTOP = 2500
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

/**
 * Refit the viewport whenever the plotted set changes (i.e. when filters change).
 * Suspended while a radius search is active — refitting there would yank the map away
 * from the circle the user is still adjusting.
 */
function FitToPoints({ points, suspended }: { points: MapPoint[]; suspended?: boolean }) {
  const map = useMap()
  useEffect(() => {
    if (suspended || points.length === 0) return
    const bounds = L.latLngBounds(points.map((pt) => [pt.lat, pt.lng] as [number, number]))
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 })
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
  unverified: '#94a3b8',
} as const

export type MapColorBy = 'market' | 'owner'

function ownerPin(ctx: OwnerContext | undefined): string {
  return ctx?.owner_contact_verified ? OWNER_PIN.verified : OWNER_PIN.unverified
}

const LEGENDS: Record<MapColorBy, { c: string; label: string }[]> = {
  market: [
    { c: PIN.on, label: 'On market' },
    { c: PIN.off, label: 'Off market' },
    { c: PIN.executed, label: 'Executed' },
  ],
  owner: [
    { c: OWNER_PIN.verified, label: 'Verified owner' },
    { c: OWNER_PIN.unverified, label: 'Not verified' },
  ],
}

export function PropertiesMap({
  properties,
  goodDealIds,
  executedIds,
  ownerContext,
  colorBy = 'market',
  polygon,
  draft,
  drawMode = false,
  onAddVertex,
}: {
  properties: Property[]
  goodDealIds?: Set<string>
  executedIds?: Set<string>
  ownerContext?: Map<string, OwnerContext>
  colorBy?: MapColorBy
  /** Completed search shape; the parent owns it because it also filters the table + export. */
  polygon?: LatLng[] | null
  /** Vertices of a shape mid-draw (draw mode active while non-null). */
  draft?: LatLng[] | null
  drawMode?: boolean
  onAddVertex?: (lat: number, lng: number) => void
}) {
  const navigate = useNavigate()

  const points = useMemo<MapPoint[]>(
    () =>
      properties
        .filter((p) => finite(p.lat) && finite(p.lng))
        .map((p) => ({ id: p.id, lat: p.lat as number, lng: p.lng as number, p })),
    [properties],
  )
  const maxMarkers = useIsDesktop() ? MAX_MARKERS_DESKTOP : MAX_MARKERS_MOBILE
  // Stable reference (memoized on points) so FitToPoints only refits when the set
  // actually changes — not on every render, which would fight the user's pan/zoom.
  const shown = useMemo(() => points.slice(0, maxMarkers), [points, maxMarkers])

  if (points.length === 0) {
    return (
      <div className="flex h-[70vh] items-center justify-center rounded-lg border border-dashed text-center">
        <p className="max-w-xs text-sm text-muted-foreground">
          None of these properties have map coordinates yet — adjust your filters or add a
          parcel/address so they can be located.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-xs text-muted-foreground">
          {points.length > shown.length
            ? `Showing ${shown.length} of ${points.length} mapped properties — narrow your filters to see the rest.`
            : `${points.length} mapped ${points.length === 1 ? 'property' : 'properties'} · hover a pin for details, click to open.`}
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
          center={[27.95, -82.5]}
          zoom={8}
          scrollWheelZoom
          className="size-full"
          style={{ background: '#f8fafc' }}
        >
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />
          <FitToPoints points={shown} suspended={drawMode || !!polygon} />
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
            const executed = executedIds?.has(id)
            const off = p.listing_status === 'off_market'
            const ctx = ownerContext?.get(id)
            // Executed wins over market status — a closed deal is usually off-market too.
            const fillColor =
              colorBy === 'owner'
                ? ownerPin(ctx)
                : executed
                  ? PIN.executed
                  : off
                    ? PIN.off
                    : PIN.on
            const loc = [p.city, p.state].filter(Boolean).join(', ')
            const bits = [
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
