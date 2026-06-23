import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { propertyKindLabels } from '@/components/property-form-dialog'
import type { Property } from '@/hooks/use-properties'
import { formatSf } from '@/lib/format'

// CircleMarkers are cheap (SVG), but each mounts a hover Tooltip, so a few hundred is
// the comfortable ceiling on a phone — cap the rendered set and tell the user to narrow
// filters for the rest.
const MAX_MARKERS = 400

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
 * click it to open the detail page. Only properties with stored coordinates appear;
 * good deals render green, off-market amber, the rest blue.
 */
export function PropertiesMap({
  properties,
  goodDealIds,
}: {
  properties: Property[]
  goodDealIds?: Set<string>
}) {
  const navigate = useNavigate()

  const points = useMemo<MapPoint[]>(
    () =>
      properties
        .filter((p) => finite(p.lat) && finite(p.lng))
        .map((p) => ({ id: p.id, lat: p.lat as number, lng: p.lng as number, p })),
    [properties],
  )
  // Stable reference (memoized on points) so FitToPoints only refits when the set
  // actually changes — not on every render, which would fight the user's pan/zoom.
  const shown = useMemo(() => points.slice(0, MAX_MARKERS), [points])

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
      <p className="text-xs text-muted-foreground">
        {points.length > shown.length
          ? `Showing ${shown.length} of ${points.length} mapped properties — narrow your filters to see the rest.`
          : `${points.length} mapped ${points.length === 1 ? 'property' : 'properties'} · hover a pin for details, click to open.`}
      </p>
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
            const good = goodDealIds?.has(id)
            const off = p.listing_status === 'off_market'
            const fillColor = good ? '#059669' : off ? '#d97706' : '#2563eb'
            const loc = [p.city, p.state].filter(Boolean).join(', ')
            const bits = [
              p.property_type ? propertyKindLabels[p.property_type] : null,
              formatSf(p.building_sf),
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
