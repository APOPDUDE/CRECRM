import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { cn } from '@/lib/utils'
import { useDealMap, type DealStatus, type MapDeal } from '@/hooks/use-deals'
import { useGeocodeMissing } from '@/hooks/use-properties'

const STATUS: Record<DealStatus, { label: string; color: string; chip: string }> = {
  active: { label: 'Active', color: '#2563eb', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  closed: { label: 'Closed', color: '#16a34a', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  lost: { label: 'Lost', color: '#dc2626', chip: 'bg-red-50 text-red-700 border-red-200' },
}
const ALL_STATUSES: DealStatus[] = ['active', 'closed', 'lost']

/** Spread deals that share the exact same coordinates so each pin is clickable. */
function spread(deals: MapDeal[]): MapDeal[] {
  const groups = new Map<string, MapDeal[]>()
  for (const d of deals) {
    const key = `${d.lat.toFixed(5)},${d.lng.toFixed(5)}`
    const arr = groups.get(key)
    if (arr) arr.push(d)
    else groups.set(key, [d])
  }
  const out: MapDeal[] = []
  for (const arr of groups.values()) {
    if (arr.length === 1) {
      out.push(arr[0])
      continue
    }
    arr.forEach((d, i) => {
      const angle = (2 * Math.PI * i) / arr.length
      out.push({ ...d, lat: d.lat + 0.0004 * Math.cos(angle), lng: d.lng + 0.0004 * Math.sin(angle) })
    })
  }
  return out
}

function FitBounds({ deals }: { deals: MapDeal[] }) {
  const map = useMap()
  useEffect(() => {
    if (deals.length === 0) return
    map.fitBounds(
      deals.map((d) => [d.lat, d.lng] as [number, number]),
      { padding: [40, 40], maxZoom: 13 },
    )
  }, [deals, map])
  return null
}

export function DashboardPage() {
  const { data: deals = [], isLoading } = useDealMap()
  useGeocodeMissing() // backfill coordinates for any properties that lack them
  const [shown, setShown] = useState<Set<DealStatus>>(new Set(ALL_STATUSES))

  const counts = useMemo(() => {
    const c: Record<DealStatus, number> = { active: 0, closed: 0, lost: 0 }
    for (const d of deals) c[d.status]++
    return c
  }, [deals])

  const visible = useMemo(() => spread(deals.filter((d) => shown.has(d.status))), [deals, shown])

  const toggle = (s: DealStatus) =>
    setShown((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Deal map — every located listing and tenant match.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => toggle(s)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-opacity',
                STATUS[s].chip,
                !shown.has(s) && 'opacity-40',
              )}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: STATUS[s].color }} />
              {STATUS[s].label}
              <span className="tabular-nums">{counts[s]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="relative h-[68vh] min-h-[420px] w-full">
          {!isLoading && deals.length === 0 && (
            <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-card/80 text-center text-sm text-muted-foreground">
              No located deals yet — scrape or add properties with an address and they'll appear here.
            </div>
          )}
          <MapContainer
            center={[39.8, -98.6]}
            zoom={4}
            scrollWheelZoom
            className="size-full"
            style={{ background: '#f8fafc' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds deals={visible} />
            {visible.map((d) => (
              <CircleMarker
                key={`${d.kind}-${d.id}`}
                center={[d.lat, d.lng]}
                radius={7}
                pathOptions={{
                  color: '#fff',
                  weight: 1.5,
                  fillColor: STATUS[d.status].color,
                  fillOpacity: 0.9,
                }}
              >
                <Popup>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 font-medium">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: STATUS[d.status].color }}
                      />
                      {d.title}
                    </div>
                    <div className="text-xs text-muted-foreground">{d.stageLabel}</div>
                    <div className="text-xs">
                      {d.address}
                      {(d.city || d.state) && (
                        <span className="text-muted-foreground">
                          {' '}
                          · {[d.city, d.state].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </div>
                    {d.price && <div className="text-xs font-medium">{d.price}</div>}
                    {d.href && (
                      <Link to={d.href} className="text-xs text-primary hover:underline">
                        View deal →
                      </Link>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </div>
    </div>
  )
}
