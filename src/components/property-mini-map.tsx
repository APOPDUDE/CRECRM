import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { cn } from '@/lib/utils'
import { geocodeAddress } from '@/lib/geocode'

interface PropertyMiniMapProps {
  lat?: number | null
  lng?: number | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  className?: string
  /** When set, the whole map becomes a click target (e.g. navigate to the property). */
  onClick?: () => void
}

const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

/**
 * A compact satellite map (Esri World Imagery) centered on one property with a pin.
 * Uses stored lat/lng when present, otherwise geocodes the address on the fly.
 * Renders nothing if it can't resolve coordinates.
 */
export function PropertyMiniMap({ lat, lng, address, city, state, zip, className, onClick }: PropertyMiniMapProps) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    finite(lat) && finite(lng) ? { lat, lng } : null,
  )

  useEffect(() => {
    if (finite(lat) && finite(lng)) {
      setCoords({ lat, lng })
      return
    }
    if (!address) {
      setCoords(null)
      return
    }
    let cancelled = false
    geocodeAddress({ address, city, state, zip }).then((r) => {
      if (!cancelled && r) setCoords(r)
    })
    return () => {
      cancelled = true
    }
  }, [lat, lng, address, city, state, zip])

  if (!coords) return null

  return (
    // `isolate z-0` confines Leaflet's high internal z-indexes (panes 200-700,
    // controls up to 1000) to this stacking context so dialogs/popovers (Radix
    // portals at z-50) always render above the map instead of behind it.
    <div
      className={cn(
        'relative isolate z-0 h-48 w-full overflow-hidden rounded-lg border',
        onClick && 'cursor-pointer',
        className,
      )}
      onClick={onClick}
    >
      <MapContainer
        key={`${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`}
        center={[coords.lat, coords.lng]}
        zoom={16}
        scrollWheelZoom={false}
        dragging={false}
        doubleClickZoom={false}
        zoomControl={false}
        attributionControl={false}
        className="size-full"
        style={{ background: '#f8fafc' }}
      >
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxZoom={19}
        />
        <CircleMarker
          center={[coords.lat, coords.lng]}
          radius={8}
          pathOptions={{ color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 0.95 }}
        />
      </MapContainer>
      {/* transparent click-catcher so a tap anywhere on the map fires onClick */}
      {onClick && <div className="absolute inset-0 z-[1000]" aria-hidden="true" />}
    </div>
  )
}
