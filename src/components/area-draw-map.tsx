import { useState } from 'react'
import { Check, Trash2, Undo2, X } from 'lucide-react'
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { TargetArea } from '@/lib/clients'

/** Each click in draw mode drops a vertex. */
function VertexCatcher({ onVertex }: { onVertex: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onVertex(e.latlng.lat, e.latlng.lng) })
  return null
}

const AREA_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2']

/**
 * Draw the areas a buyer will buy in. Polygons beat city names or zip lists: an address
 * either falls inside a shape or it doesn't, so the browser and public.point_in_ring()
 * always agree and nothing depends on how a city got typed.
 */
export function AreaDrawMap({
  areas,
  onChange,
  center = { lat: 27.95, lng: -82.5 },
  zoom = 8,
}: {
  areas: TargetArea[]
  onChange: (areas: TargetArea[]) => void
  center?: { lat: number; lng: number }
  zoom?: number
}) {
  const [draft, setDraft] = useState<[number, number][] | null>(null)
  const [name, setName] = useState('')

  const finish = () => {
    if (!draft || draft.length < 3) return
    onChange([...areas, { name: name.trim() || `Area ${areas.length + 1}`, ring: draft }])
    setDraft(null)
    setName('')
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {draft === null ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft([])}>
            Draw an area
          </Button>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">
              {draft.length < 3
                ? `Click the map to drop corners (${draft.length}/3 minimum)`
                : `${draft.length} corners — name it and finish`}
            </span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Area name, e.g. East Tampa"
              className="h-8 w-48"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!draft.length}
              onClick={() => setDraft((d) => (d ? d.slice(0, -1) : d))}
            >
              <Undo2 className="size-3.5" />
              Undo point
            </Button>
            <Button type="button" size="sm" disabled={draft.length < 3} onClick={finish}>
              <Check className="size-3.5" />
              Finish
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(null)
                setName('')
              }}
            >
              Cancel
            </Button>
          </>
        )}
      </div>

      {areas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {areas.map((a, i) => (
            <Badge key={`${a.name}-${i}`} variant="secondary" className="gap-1 font-normal">
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: AREA_COLORS[i % AREA_COLORS.length] }}
              />
              {a.name}
              <button
                type="button"
                onClick={() => onChange(areas.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${a.name}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          {areas.length > 1 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
              <Trash2 className="size-3.5" />
              Clear all
            </Button>
          )}
        </div>
      )}

      {/* isolate z-0 keeps Leaflet's z-indexes from covering the dialog chrome */}
      <div className="relative isolate z-0 h-64 w-full overflow-hidden rounded-lg border">
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={zoom}
          scrollWheelZoom
          className="size-full"
          style={{ background: '#f8fafc' }}
        >
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />
          {draft !== null && (
            <VertexCatcher onVertex={(lat, lng) => setDraft((d) => [...(d ?? []), [lat, lng]])} />
          )}
          {areas.map((a, i) => (
            <Polygon
              key={`${a.name}-${i}`}
              positions={a.ring}
              pathOptions={{
                color: AREA_COLORS[i % AREA_COLORS.length],
                weight: 2,
                fillColor: AREA_COLORS[i % AREA_COLORS.length],
                fillOpacity: 0.12,
              }}
              interactive={false}
            />
          ))}
          {draft && draft.length > 0 && (
            <>
              <Polyline
                positions={draft}
                pathOptions={{ color: '#2563eb', weight: 2, dashArray: '6 4' }}
                interactive={false}
              />
              {draft.map((v, i) => (
                <CircleMarker
                  key={`draft-${i}`}
                  center={v}
                  radius={4}
                  pathOptions={{ color: '#2563eb', weight: 2, fillColor: '#fff', fillOpacity: 1 }}
                  interactive={false}
                />
              ))}
            </>
          )}
        </MapContainer>
      </div>
    </div>
  )
}
