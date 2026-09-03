import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  EASEMENT_LAYER,
  IMAGERY_YEARS,
  REFERENCE_LAYERS,
  UTILITY_LAYERS,
  imageryCoverage,
  type ReferenceLayerId,
  type UtilityLayerId,
} from '@/lib/map-layers'
import type { OverlayState } from '@/lib/overlays'

function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full ring-1 ring-border"
      style={{ backgroundColor: color }}
    />
  )
}

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2 text-sm">
      <button type="button" className="flex w-full items-center gap-1.5 font-medium" onClick={onToggle}>
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        {title}
      </button>
      {open && <div className="space-y-1.5 pl-1.5">{children}</div>}
    </div>
  )
}

/**
 * The rail's Reference / Utilities + easements / Historical imagery entries — the
 * Paxiv Overlays and Basemap panels, in the same expandable shape as the zoning
 * layers above them. State lives in the parent's OverlayState so it persists with
 * the rest of the map.
 */
export function MapLayerControls({
  state,
  onChange,
}: {
  state: OverlayState
  onChange: (next: OverlayState) => void
}) {
  const anyReference = REFERENCE_LAYERS.some((l) => state.reference[l.id])
  const [refOpen, setRefOpen] = useState(anyReference)
  const anyUtility = UTILITY_LAYERS.some((l) => state.utilities[l.id])
  const [utilOpen, setUtilOpen] = useState(anyUtility || state.easements)
  const [imgOpen, setImgOpen] = useState(state.imageryYear != null)

  const toggleReference = (id: ReferenceLayerId) =>
    onChange({ ...state, reference: { ...state.reference, [id]: !state.reference[id] } })

  const toggleUtility = (id: UtilityLayerId) =>
    onChange({ ...state, utilities: { ...state.utilities, [id]: !state.utilities[id] } })
  const setAllLayers = (on: boolean) =>
    onChange({
      ...state,
      utilities: Object.fromEntries(UTILITY_LAYERS.map((l) => [l.id, on])) as Partial<Record<UtilityLayerId, boolean>>,
      easements: on,
    })
  const allOn = UTILITY_LAYERS.every((l) => state.utilities[l.id]) && state.easements
  const noneOn = !anyUtility && !state.easements

  const years = [...IMAGERY_YEARS].reverse()
  const yearIdx = state.imageryYear == null ? -1 : IMAGERY_YEARS.indexOf(state.imageryYear)
  const setYear = (y: number | null) => onChange({ ...state, imageryYear: y })

  return (
    <div className="space-y-3">
      {/* Streets, city limits, county lines — the names and edges an aerial basemap
          lacks (Alex 2026-09-03). */}
      <Section title="Streets + boundaries" open={refOpen} onToggle={() => setRefOpen((v) => !v)}>
        {REFERENCE_LAYERS.map((l) => (
          <label key={l.id} className="flex cursor-pointer items-start gap-2" title={l.hint}>
            <Checkbox checked={!!state.reference[l.id]} onCheckedChange={() => toggleReference(l.id)} className="mt-0.5" />
            <span className="flex flex-col">
              <span className="flex items-center gap-2">
                <Dot color={l.color} />
                {l.label}
              </span>
              <span className="text-xs text-muted-foreground">{l.hint}</span>
            </span>
          </label>
        ))}
      </Section>

      <Section title="Utilities, railroads + easements" open={utilOpen} onToggle={() => setUtilOpen((v) => !v)}>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={allOn} onClick={() => setAllLayers(true)}>
            Select all
          </Button>
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={noneOn} onClick={() => setAllLayers(false)}>
            Clear
          </Button>
        </div>
        {UTILITY_LAYERS.map((l, i) => (
          <Fragment key={l.id}>
            {i > 0 && UTILITY_LAYERS[i - 1].group !== l.group && (
              <div className="pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">Environment</div>
            )}
            <label className="flex cursor-pointer items-start gap-2" title={l.hint}>
              <Checkbox checked={!!state.utilities[l.id]} onCheckedChange={() => toggleUtility(l.id)} className="mt-0.5" />
              <span className="flex flex-col">
                <span className="flex items-center gap-2">
                  <Dot color={l.color} />
                  {l.label}
                </span>
                <span className="text-xs text-muted-foreground">{l.hint}</span>
              </span>
            </label>
          </Fragment>
        ))}
        <label className="flex cursor-pointer items-start gap-2" title={EASEMENT_LAYER.hint}>
          <Checkbox
            checked={state.easements}
            onCheckedChange={(v) => onChange({ ...state, easements: v === true })}
            className="mt-0.5"
          />
          <span className="flex flex-col">
            <span className="flex items-center gap-2">
              <Dot color={EASEMENT_LAYER.color} />
              Recorded easements
            </span>
            <span className="text-xs text-muted-foreground">{EASEMENT_LAYER.hint}</span>
          </span>
        </label>
        <p className="text-xs text-muted-foreground">
          Mains show from zoom 16 and easements from 15 (a few blocks). Hover a line for diameter, material, status and owner.
        </p>
      </Section>

      <Section title="Historical imagery" open={imgOpen} onToggle={() => setImgOpen((v) => !v)}>
        <select
          className="h-8 w-full rounded-md border bg-background px-2 text-xs"
          value={state.imageryYear ?? ''}
          onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Current (Esri World Imagery)</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        {/* the slider walks the years that actually exist, oldest left */}
        <div className="flex items-center gap-2">
          <span className="w-8 text-xs text-muted-foreground">{IMAGERY_YEARS[0]}</span>
          <input
            type="range"
            min={0}
            max={IMAGERY_YEARS.length}
            value={yearIdx < 0 ? IMAGERY_YEARS.length : yearIdx}
            onChange={(e) => {
              const i = Number(e.target.value)
              setYear(i >= IMAGERY_YEARS.length ? null : IMAGERY_YEARS[i])
            }}
            className="w-full accent-primary"
            aria-label="Imagery year"
          />
          <span className="w-8 text-right text-xs text-muted-foreground">Now</span>
        </div>
        {state.imageryYear != null ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{state.imageryYear}</span> · {imageryCoverage(state.imageryYear)}. Outside
            that coverage the map still shows today's imagery.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Esri Wayback 2014 → today for the whole book; Pinellas back to 1980 and Hillsborough 1938 from the counties.
          </p>
        )}
      </Section>
    </div>
  )
}
