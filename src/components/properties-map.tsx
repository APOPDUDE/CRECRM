import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { propertyKindLabels } from '@/components/property-form-dialog'
import type { Property } from '@/hooks/use-properties'
import { formatSf } from '@/lib/format'

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

/** Refit the viewport whenever the plotted set changes (i.e. when filters change). */
function FitToPoints({ points }: { points: MapPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    const bounds = L.latLngBounds(points.map((pt) => [pt.lat, pt.lng] as [number, number]))
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 })
  }, [points, map])
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

export function PropertiesMap({
  properties,
  goodDealIds,
  executedIds,
}: {
  properties: Property[]
  goodDealIds?: Set<string>
  executedIds?: Set<string>
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
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {[
            { c: PIN.on, label: 'On market' },
            { c: PIN.off, label: 'Off market' },
            { c: PIN.executed, label: 'Executed' },
          ].map(({ c, label }) => (
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
          <FitToPoints points={shown} />
          {shown.map(({ id, lat, lng, p }) => {
            const executed = executedIds?.has(id)
            const off = p.listing_status === 'off_market'
            // Executed wins over market status — a closed deal is usually off-market too.
            const fillColor = executed ? PIN.executed : off ? PIN.off : PIN.on
            const loc = [p.city, p.state].filter(Boolean).join(', ')
            const bits = [
              p.property_type ? propertyKindLabels[p.property_type] : null,
              formatSf(p.building_sf),
              executed ? 'Executed' : off ? 'Off market' : 'On market',
              goodDealIds?.has(id) ? 'Good deal' : null,
            ].filter(Boolean)
            return (
              <CircleMarker
                key={id}
                center={[lat, lng]}
                radius={7}
                pathOptions={{ color: '#fff', weight: 1.5, fillColor, fillOpacity: 0.9 }}
                eventHandlers={{ click: () => navigate(`/properties/${id}`) }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  <div className="text-xs leading-snug">
                    <div className="font-medium">{p.address}</div>
                    {loc && <div className="opacity-70">{loc}</div>}
                    {bits.length > 0 && <div className="opacity-70">{bits.join(' · ')}</div>}
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
