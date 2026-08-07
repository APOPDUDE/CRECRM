import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
 * Clicking it opens the in-app Deal Map filtered to this property: the address goes
 * through the same search the Properties page uses, so a single match auto-fits to
 * zoom 17 and the county parcel outline (zoom >= 16) draws around it.
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

  // The Deal Map lives on the Properties page; `q` seeds its search box and
  // `view=map` flips it to the map tab. Search the address only (not city/state/zip):
  // the canonical matcher requires every query token to appear, and a stored row
  // missing a zip would otherwise drop its own property out of the results.
  const dealMapUrl = address
    ? `/properties?view=map&q=${encodeURIComponent(address)}`
    : null

  // No stored coords and geocoding hasn't resolved (or there's nothing to geocode):
  // keep the slot visible with a link in instead of vanishing.
  if (!coords) {
    if (!dealMapUrl) return null
    return (
      <Link
        to={dealMapUrl}
        title="Open on the Deal Map"
        className={cn(
          'flex h-48 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 text-muted-foreground',
          className,
        )}
      >
        <MapPin className="size-5" />
        <span className="text-xs">Open on the Deal Map</span>
      </Link>
    )
  }

  return (
    // `isolate z-0` confines Leaflet's high internal z-indexes (panes 200-700,
    // controls up to 1000) to this stacking context so dialogs/popovers (Radix
    // portals at z-50) always render above the map instead of behind it.
    <Link
      to={dealMapUrl ?? '/properties?view=map'}
      title="Open on the Deal Map"
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
    </Link>
  )
}
