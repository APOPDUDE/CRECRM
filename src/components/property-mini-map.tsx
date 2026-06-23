import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
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
}

const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

/**
 * A compact satellite map (Esri World Imagery) centered on one property with a pin.
 * Uses stored lat/lng when present, otherwise geocodes the address on the fly.
 * Clicking it opens the address in Google Maps. Renders nothing if it can't resolve coordinates.
 */
export function PropertyMiniMap({ lat, lng, address, city, state, zip, className }: PropertyMiniMapProps) {
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

  const query = address
    ? [address, city, state, zip].filter(Boolean).join(', ')
    : coords
      ? `${coords.lat},${coords.lng}`
      : ''
  const mapsUrl = query
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
    : null

  // No stored coords and geocoding hasn't resolved (or there's nothing to geocode):
  // keep the slot visible with a link out instead of vanishing.
  if (!coords) {
    if (!mapsUrl) return null
    return (
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open in Google Maps"
        className={cn(
          'flex h-48 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 text-muted-foreground',
          className,
        )}
      >
        <MapPin className="size-5" />
        <span className="text-xs">Open in Google Maps</span>
      </a>
    )
  }

  return (
    // `isolate z-0` confines Leaflet's high internal z-indexes (panes 200-700,
    // controls up to 1000) to this stacking context so dialogs/popovers (Radix
    // portals at z-50) always render above the map instead of behind it.
    <a
      href={mapsUrl ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in Google Maps"
      className={cn(
        'relative isolate z-0 block h-48 w-full cursor-pointer overflow-hidden rounded-lg border',
        className,
      )}
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
      {/* transparent click-catcher so a tap anywhere on the map follows the link
          instead of being swallowed by Leaflet */}
      <span className="absolute inset-0 z-[1000]" aria-hidden="true" />
    </a>
  )
}
