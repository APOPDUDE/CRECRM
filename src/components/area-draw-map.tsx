import { useMemo, useState } from 'react'
import { Check, Trash2, Undo2, X } from 'lucide-react'
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fetchNamedAreaTargets, useNamedAreaList } from '@/hooks/use-named-areas'
import type { NamedAreaOption } from '@/hooks/use-named-areas'
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
  const [areaQuery, setAreaQuery] = useState('')
  const namedAreas = useNamedAreaList()

  // Typed county/city → real boundary polygon, no drawing. Same {name, ring}
  // shape as a drawn area, so matching downstream can't tell them apart.
  const namedMatches = useMemo(() => {
    const q = areaQuery.trim().toLowerCase()
    if (q.length < 2) return []
    const list = namedAreas.data ?? []
    const starts = list.filter((a) => a.name.toLowerCase().startsWith(q))
    const contains = list.filter(
      (a) => !a.name.toLowerCase().startsWith(q) && a.name.toLowerCase().includes(q),
    )
    return [...starts, ...contains].slice(0, 8)
  }, [areaQuery, namedAreas.data])

  const addNamed = async (opt: NamedAreaOption) => {
    setAreaQuery('')
    try {
      const targets = await fetchNamedAreaTargets(opt.id)
      const existing = new Set(areas.map((a) => a.name))
      const fresh = targets.filter((t) => !existing.has(t.name))
      if (!fresh.length) {
        toast.info(`${opt.name} is already on the map`)
        return
      }
      onChange([...areas, ...fresh])
    } catch {
      toast.error(`Couldn't load the boundary for ${opt.name}`)
    }
  }

  const finish = () => {
    if (!draft || draft.length < 3) return
    onChange([...areas, { name: name.trim() || `Area ${areas.length + 1}`, ring: draft }])
    setDraft(null)
    setName('')
  }

  const hint =
    draft === null
      ? ''
      : draft.length < 3
        ? `Click the map to drop corners (${draft.length}/3 minimum)`
        : `${draft.length} corners — name it and finish`

  // Everything above the map holds a constant height. Anything that grows or shrinks
  // mid-draw — the hint swapping at the third corner, a saved-area chip appearing —
  // would push the map down the page and yank the view out from under the next click.
  return (
    <div className="space-y-2">
      <div className="flex h-8 items-center gap-2">
        {draft === null ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setDraft([])}>
              Draw an area
            </Button>
            <div className="relative">
              <Input
                value={areaQuery}
                onChange={(e) => setAreaQuery(e.target.value)}
                placeholder="Add a county or city..."
                className="h-8 w-52"
              />
              {namedMatches.length > 0 && (
                <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-md border bg-popover shadow-md">
                  {namedMatches.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => void addNamed(m)}
                      className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <span className="truncate">{m.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {m.kind === 'county' ? 'County' : m.county ? `${m.county} Co.` : 'City'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Area name, e.g. East Tampa"
              className="h-8 w-48 shrink-0"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={!draft.length}
              onClick={() => setDraft((d) => (d ? d.slice(0, -1) : d))}
            >
              <Undo2 className="size-3.5" />
              Undo point
            </Button>
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              disabled={draft.length < 3}
              onClick={finish}
            >
              <Check className="size-3.5" />
              Finish
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
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

      {/* Reserved line: the text changes as you draw, the height never does. */}
      <p className="h-4 truncate text-xs text-muted-foreground">{hint}</p>

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

      {/* Saved areas live BELOW the map, so finishing one never shifts the map itself. */}
      {areas.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
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
    </div>
  )
}
