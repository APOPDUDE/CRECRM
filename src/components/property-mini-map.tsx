import { useEffect, useMemo, useState } from 'react'
import { MapPin } from 'lucide-react'
import { CircleMarker, GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { cn } from '@/lib/utils'
import { geocodeAddress } from '@/lib/geocode'
import { pointInPolygon } from '@/lib/geo'
import {
  PARCEL_SERVICES,
  outerRings,
  parcelKey,
  parcelKeys,
  ringsBbox,
} from '@/components/properties-map'
import { MapLayers } from '@/components/map-utility-layers'

/** What the property page's map always shows around the parcel: mains and easements. */
const MINI_LAYERS = { utilities: { water: true, sewer: true, rail: true }, easements: true } as const

interface PropertyMiniMapProps {
  lat?: number | null
  lng?: number | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  /** For outlining the exact county parcel(s) — an assemblage lists several, comma-separated. */
  parcelNumber?: string | null
  className?: string
}

const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

type OutlineFeature = { type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }

/**
 * The property's own parcel outline, straight from the county GIS (same endpoints and
 * matching rules as the War Room's ParcelLines): ask for the handful of parcels around
 * the point, keep the ones whose parcel id matches ours, else the one containing the
 * point. The envelope only FILTERS which parcels intersect — the county returns each
 * matching polygon whole, so a tiny box still yields the full parcel.
 */
async function fetchParcelOutline(
  lat: number,
  lng: number,
  parcelField: string | null | undefined,
): Promise<OutlineFeature[] | null> {
  const pad = 0.0004 // ~44m: the containing parcel plus immediate neighbours
  const env = `${lng - pad},${lat - pad},${lng + pad},${lat + pad}`
  const services = PARCEL_SERVICES.filter(
    (s) => lat >= s.box[0] && lat <= s.box[2] && lng >= s.box[1] && lng <= s.box[3],
  )
  if (services.length === 0) return null
  const keys = parcelKeys(parcelField)
  const feats: { f: OutlineFeature; svc: (typeof PARCEL_SERVICES)[number] }[] = []
  await Promise.all(
    services.map(async (svc) => {
      try {
        const u =
          `${svc.url}/query?where=1%3D1&geometry=${encodeURIComponent(env)}` +
          `&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326` +
          `&spatialRel=esriSpatialRelIntersects&returnGeometry=true` +
          `&outFields=${encodeURIComponent(svc.fields.join(','))}&resultRecordCount=50&f=geojson`
        const r = await fetch(u)
        const d = await r.json()
        if (Array.isArray(d?.features)) {
          for (const f of d.features) feats.push({ f, svc })
        }
      } catch {
        // county service down or CORS-blocked — the map simply shows no outline
      }
    }),
  )
  // Same two matching passes as the War Room: parcel-key equality first (authoritative,
  // and the only way an assemblage gets ALL its lots), point-in-polygon as the fallback
  // for the ~20% whose stored parcel number doesn't line up with the county's key.
  const byKey = feats.filter(({ f, svc }) => {
    const k = parcelKey(svc.attrs((f.properties ?? {}) as Record<string, unknown>).parcel)
    return k != null && keys.includes(k)
  })
  const kept = byKey.length
    ? byKey
    : feats.filter(({ f }) =>
        outerRings(f.geometry as never).some((ring) => pointInPolygon(ring, lat, lng)),
      )
  return kept.length ? kept.map((x) => x.f) : null
}

/** Fit the camera to the outline once it lands — "zoomed in enough to see the outline". */
function FitToOutline({ features }: { features: OutlineFeature[] | null }) {
  const map = useMap()
  useEffect(() => {
    if (!features) return
    const rings = features.flatMap((f) => outerRings(f.geometry as never))
    if (rings.length === 0) return
    const [minLat, minLng, maxLat, maxLng] = ringsBbox(rings)
    map.fitBounds(
      [
        [minLat, minLng],
        [maxLat, maxLng],
      ],
      { padding: [14, 14], maxZoom: 18 },
    )
  }, [features, map])
  return null
}

const OUTLINE_STYLE = {
  color: '#2563eb',
  weight: 3,
  opacity: 1,
  fill: true,
  fillColor: '#2563eb',
  fillOpacity: 0.1,
}

/**
 * A compact interactive satellite map (Esri World Imagery) of one property: pan, zoom,
 * and the county parcel outline drawn around it, starting fitted to that outline.
 * Deliberately NOT a link anywhere — it used to deep-link into the War Room's search,
 * which wiped the sticky filters mid-canvass (Alex, 2026-08-19: "when I click the map
 * on a property while doing a search it resets the search criteria").
 */
export function PropertyMiniMap({ lat, lng, address, city, state, zip, parcelNumber, className }: PropertyMiniMapProps) {
  // The pin is the stored point when there is one, else whatever the address geocodes to.
  const hasPoint = finite(lat) && finite(lng)
  const [geocoded, setGeocoded] = useState<{ lat: number; lng: number } | null>(null)
  useEffect(() => {
    if (hasPoint || !address) return
    let cancelled = false
    geocodeAddress({ address, city, state, zip }).then((r) => {
      if (!cancelled && r) setGeocoded(r)
    })
    return () => {
      cancelled = true
    }
  }, [hasPoint, address, city, state, zip])
  const coords = useMemo(
    () => (finite(lat) && finite(lng) ? { lat, lng } : address ? geocoded : null),
    [lat, lng, address, geocoded],
  )

  // The outline remembers which point it was fetched for, so a stale one never draws
  // around a different pin while the next fetch is in flight.
  const outlineKey = coords ? `${coords.lat},${coords.lng},${parcelNumber ?? ''}` : null
  const [fetched, setFetched] = useState<{ key: string; features: OutlineFeature[] | null } | null>(null)
  useEffect(() => {
    if (!coords || !outlineKey) return
    let cancelled = false
    fetchParcelOutline(coords.lat, coords.lng, parcelNumber).then((features) => {
      if (!cancelled) setFetched({ key: outlineKey, features })
    })
    return () => {
      cancelled = true
    }
  }, [coords, outlineKey, parcelNumber])
  const outline = fetched?.key === outlineKey ? fetched.features : null

  // No stored coords and geocoding hasn't resolved (or there's nothing to geocode):
  // keep the slot visible instead of vanishing.
  if (!coords) {
    return (
      <div
        className={cn(
          'flex h-48 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 text-muted-foreground',
          className,
        )}
      >
        <MapPin className="size-5" />
        <span className="text-xs">No map location yet</span>
      </div>
    )
  }

  return (
    // `isolate z-0` confines Leaflet's high internal z-indexes (panes 200-700,
    // controls up to 1000) to this stacking context so dialogs/popovers (Radix
    // portals at z-50) always render above the map instead of behind it.
    <div
      className={cn('relative isolate z-0 block h-48 w-full overflow-hidden rounded-lg border', className)}
    >
      <MapContainer
        key={`${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`}
        center={[coords.lat, coords.lng]}
        zoom={17}
        scrollWheelZoom
        attributionControl={false}
        className="size-full"
        style={{ background: '#f8fafc' }}
      >
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxZoom={19}
        />
        {outline && (
          <GeoJSON
            key={outline.length}
            data={{ type: 'FeatureCollection', features: outline } as never}
            style={() => OUTLINE_STYLE}
            interactive={false}
          />
        )}
        <CircleMarker
          center={[coords.lat, coords.lng]}
          radius={7}
          pathOptions={{ color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 0.95 }}
        />
        {/* the utilities and recorded easements around the parcel, same cache as the War Room */}
        <MapLayers state={MINI_LAYERS} />
        <FitToOutline features={outline} />
      </MapContainer>
    </div>
  )
}
