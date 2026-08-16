import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  OVERLAY_COLORS,
  OVERLAY_LABELS,
  OVERLAY_TYPES,
  type LayerSelection,
  type OverlayState,
  type OverlayType,
} from '@/lib/overlays'
import { overlayCodeEntries, useZoningOverlay, type OverlayCodeEntry } from '@/hooks/use-overlays'

function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full ring-1 ring-white"
      style={{ backgroundColor: color }}
    />
  )
}

/**
 * The map's overlay rail: "Zoning layers" as one expandable entry — each type its own
 * checkbox in Alex's colours, per-code search-and-check inside it — plus Lowlands.
 *
 * A type checkbox is tri-state: all of its districts, a hand-picked subset
 * (indeterminate), or off. "Include in search" appears under a toggled-on layer and
 * unions that layer's properties into the filtered set, so exports and skip-trace
 * carry them (the parent owns that logic; this is just the switch).
 */
export function OverlayControls({
  state,
  onChange,
  onIncludeOn,
}: {
  state: OverlayState
  onChange: (next: OverlayState) => void
  /** Fired when an include toggles ON — the parent starts the book fetch the union needs. */
  onIncludeOn?: () => void
}) {
  const anyZoning = OVERLAY_TYPES.some((t) => state[t] !== 'off')
  const [expanded, setExpanded] = useState(anyZoning)
  const [codeSearch, setCodeSearch] = useState('')

  const { data: fc, isFetching } = useZoningOverlay(expanded || anyZoning)
  const entries = useMemo(() => overlayCodeEntries(fc), [fc])
  const keysByBucket = useMemo(() => {
    const m = new Map<OverlayType, string[]>()
    for (const e of entries) {
      const arr = m.get(e.bucket) ?? []
      arr.push(e.key)
      m.set(e.bucket, arr)
    }
    return m
  }, [entries])

  const setLayer = (t: OverlayType, sel: LayerSelection) => onChange({ ...state, [t]: sel })

  const toggleType = (t: OverlayType) => setLayer(t, state[t] === 'off' ? 'all' : 'off')

  const toggleInclude = (t: OverlayType) => {
    const next = !state.include[t]
    onChange({ ...state, include: { ...state.include, [t]: next } })
    if (next) onIncludeOn?.()
  }

  const codeChecked = (e: OverlayCodeEntry): boolean => {
    const sel = state[e.bucket]
    return sel === 'all' || (sel !== 'off' && sel.includes(e.key))
  }

  const toggleCode = (e: OverlayCodeEntry) => {
    const sel = state[e.bucket]
    const all = keysByBucket.get(e.bucket) ?? []
    let next: LayerSelection
    if (sel === 'all') {
      next = all.filter((k) => k !== e.key)
    } else if (sel === 'off') {
      next = [e.key]
    } else if (sel.includes(e.key)) {
      const arr = sel.filter((k) => k !== e.key)
      next = arr.length ? arr : 'off'
    } else {
      const arr = [...sel, e.key]
      // Hand-checking the last missing code is the same as "all" — and collapsing to
      // 'all' keeps the union semantics (crossovers included) rather than a list.
      next = arr.length >= all.length ? 'all' : arr
    }
    setLayer(e.bucket, next)
  }

  // No search text: the picker shows the codes of the layers that are ON (what is
  // painting right now). Typed: every district that matches, any layer — finding and
  // checking a code must not require its layer to be on first.
  const visibleEntries = useMemo(() => {
    const q = codeSearch.trim().toLowerCase()
    if (q) {
      // Codes lead, prefix matches first. Descriptions/jurisdictions join only from
      // 3 characters — a 2-letter query like "IG" would otherwise drag in every
      // description containing "light" or "neighborhood".
      const codeHits = entries
        .filter((e) => e.code.toLowerCase().includes(q))
        .sort((a, b) => Number(b.code.toLowerCase().startsWith(q)) - Number(a.code.toLowerCase().startsWith(q)))
      if (q.length < 3) return codeHits
      const seen = new Set(codeHits.map((e) => e.key))
      const textHits = entries.filter(
        (e) =>
          !seen.has(e.key) &&
          (e.jurisdiction.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)),
      )
      return [...codeHits, ...textHits]
    }
    return entries.filter((e) => state[e.bucket] !== 'off')
  }, [entries, codeSearch, state])

  return (
    <div className="space-y-2 text-sm">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 font-medium"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        Zoning layers
      </button>
      {expanded && (
        <div className="space-y-1.5 pl-1.5">
          {OVERLAY_TYPES.map((t) => {
            const sel = state[t]
            return (
              <div key={t} className="space-y-1">
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={sel === 'all' ? true : sel === 'off' ? false : 'indeterminate'}
                    onCheckedChange={() => toggleType(t)}
                  />
                  <Dot color={OVERLAY_COLORS[t]} />
                  <span>{OVERLAY_LABELS[t]}</span>
                  {Array.isArray(sel) && (
                    <span className="text-xs text-muted-foreground">
                      {sel.length} code{sel.length === 1 ? '' : 's'}
                    </span>
                  )}
                </label>
                {sel !== 'off' && (
                  <div className="pl-6">
                    <Button
                      size="sm"
                      variant={state.include[t] ? 'secondary' : 'outline'}
                      className="h-6 px-2 text-xs"
                      title="Add every property inside this overlay to the current filtered set, so the count and exports carry them"
                      onClick={() => toggleInclude(t)}
                    >
                      {state.include[t] ? 'Included in search' : 'Include in search'}
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
          <div className="space-y-1 pt-1">
            <div className="relative">
              <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={codeSearch}
                onChange={(e) => setCodeSearch(e.target.value)}
                placeholder="Search codes… (IG, M-1, CG)"
                className="h-8 pl-7 text-xs"
              />
            </div>
            {isFetching && <p className="text-xs text-muted-foreground">Loading districts…</p>}
            {visibleEntries.length > 0 && (
              <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
                {visibleEntries.map((e) => (
                  <label
                    key={e.key}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-accent/50"
                    title={e.description || undefined}
                  >
                    <Checkbox checked={codeChecked(e)} onCheckedChange={() => toggleCode(e)} />
                    <Dot color={OVERLAY_COLORS[e.bucket]} />
                    <span className="truncate">{e.code}</span>
                    <span className="truncate text-xs text-muted-foreground italic">
                      {e.jurisdiction.replace(/^City of /, '')}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {!isFetching && codeSearch.trim() && visibleEntries.length === 0 && (
              <p className="text-xs text-muted-foreground">No district matches “{codeSearch.trim()}”.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
