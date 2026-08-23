import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useDorCodes, type DorCodeEntry } from '@/hooks/use-dor-codes'
import {
  DOR_MAJORS,
  DOR_SELECTION_DEFAULT,
  dorSelectionActive,
  type DorLayerSelection,
  type DorMajor,
  type DorSelection,
} from '@/lib/zoning'
import { OVERLAY_COLORS } from '@/lib/overlays'

const MAJOR_LABELS: Record<DorMajor, string> = {
  industrial: 'Industrial',
  retail: 'Retail',
  office: 'Office',
  multifamily: 'Multifamily',
  land: 'Land',
}

/** The land major has no zoning-overlay twin, so it carries its own swatch. */
const LAND_DOT = '#ca8a04'

/**
 * Which majors a book offers. The land book asks a different question — what the
 * county calls this dirt — so it shows Land alone rather than the four building
 * categories (Alex 2026-08-21). The industrial book is unchanged.
 */
const MAJORS_FOR_BOOK: Record<'industrial' | 'land', readonly DorMajor[]> = {
  industrial: DOR_MAJORS.filter((m) => m !== 'land'),
  land: ['land'],
}

const CATEGORY_LABELS: Record<DorCodeEntry['category'], string> = {
  industrial: 'Industrial',
  office: 'Office',
  retail: 'Retail',
  multifamily: 'Multifamily',
  other: 'Other',
}

function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full ring-1 ring-white"
      style={{ backgroundColor: color }}
    />
  )
}

/**
 * The DOR-code picker, shaped like the zoning layers (Alex, 2026-08-16): four major
 * categories — Industrial (which files 027 with it, per the seeded dor_codes table),
 * Retail, Office, Multifamily — each a tri-state checkbox whose code list can be
 * edited underneath, plus search that finds ANY code: standard 'other' codes (001…)
 * and county customs (county in faint italics, matching verbatim) check into `extra`.
 * Hover a code for its description + general category.
 */
export function DorCodePicker({
  selection,
  onChange,
  book = 'industrial',
}: {
  selection: DorSelection
  onChange: (next: DorSelection) => void
  /** Which book is open — decides which majors and codes the picker offers. */
  book?: 'industrial' | 'land'
}) {
  const [expanded, setExpanded] = useState(dorSelectionActive(selection))
  const [search, setSearch] = useState('')
  const { data: entries = [], isFetching } = useDorCodes(expanded || dorSelectionActive(selection))

  const majors = MAJORS_FOR_BOOK[book]

  /**
   * Which major a code belongs to IN THIS BOOK, or null when it can only be picked
   * individually (an `extra`). In the land book that is the land_class flag; in the
   * industrial book it is the seeded category, with 'other' and county customs as
   * extras exactly as before.
   */
  const majorOf = (e: DorCodeEntry): DorMajor | null => {
    if (book === 'land') return e.landClass ? 'land' : null
    if (e.county || e.category === 'other') return null
    return e.category as DorMajor
  }

  const keysByMajor = useMemo(() => {
    const m = new Map<DorMajor, string[]>()
    for (const e of entries) {
      const major = book === 'land' ? (e.landClass ? 'land' : null) : (e.county || e.category === 'other' ? null : (e.category as DorMajor))
      if (!major) continue
      const arr = m.get(major) ?? []
      arr.push(e.key)
      m.set(major, arr)
    }
    return m
  }, [entries, book])

  const setMajor = (m: DorMajor, sel: DorLayerSelection) => onChange({ ...selection, [m]: sel })

  const entryChecked = (e: DorCodeEntry): boolean => {
    const major = majorOf(e)
    if (!major) return selection.extra.includes(e.key)
    const sel = selection[major]
    return sel === 'all' || (sel !== 'off' && sel.includes(e.key))
  }

  const toggleEntry = (e: DorCodeEntry) => {
    const majorForEntry = majorOf(e)
    if (!majorForEntry) {
      const extra = selection.extra.includes(e.key)
        ? selection.extra.filter((k) => k !== e.key)
        : [...selection.extra, e.key]
      onChange({ ...selection, extra })
      return
    }
    const major = majorForEntry
    const sel = selection[major]
    const all = keysByMajor.get(major) ?? []
    let next: DorLayerSelection
    if (sel === 'all') {
      next = all.filter((k) => k !== e.key)
    } else if (sel === 'off') {
      next = [e.key]
    } else if (sel.includes(e.key)) {
      const arr = sel.filter((k) => k !== e.key)
      next = arr.length ? arr : 'off'
    } else {
      const arr = [...sel, e.key]
      next = arr.length >= all.length ? 'all' : arr
    }
    setMajor(major, next)
  }

  // Untyped: the codes of majors that are ON plus everything checked into extra —
  // what is filtering right now. Typed: every code that matches, any category.
  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q) {
      const codeHits = entries
        .filter((e) => e.code.toLowerCase().includes(q))
        .sort((a, b) => Number(b.code.toLowerCase().startsWith(q)) - Number(a.code.toLowerCase().startsWith(q)))
      const seen = new Set(codeHits.map((e) => e.key))
      const textHits = entries.filter(
        (e) =>
          !seen.has(e.key) &&
          (e.description.toLowerCase().includes(q) ||
            e.category.includes(q) ||
            (e.county ?? '').toLowerCase().includes(q)),
      )
      return [...codeHits, ...textHits]
    }
    return entries.filter((e) => {
      const major = majorOf(e)
      // in the land book a non-land code is not on the menu at all
      if (book === 'land' && !major && !e.landClass) return selection.extra.includes(e.key)
      return major ? selection[major] !== 'off' : selection.extra.includes(e.key)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, search, selection, book])

  const extraCount = selection.extra.length

  return (
    <div className="space-y-2 text-sm">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 font-medium"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        County use (DOR)
      </button>
      {expanded && (
        <div className="space-y-1.5 pl-1.5">
          {majors.map((m) => {
            const sel = selection[m]
            return (
              <label key={m} className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={sel === 'all' ? true : sel === 'off' ? false : 'indeterminate'}
                  onCheckedChange={() => setMajor(m, sel === 'off' ? 'all' : 'off')}
                />
                <Dot color={m === 'land' ? LAND_DOT : OVERLAY_COLORS[m]} />
                <span>{MAJOR_LABELS[m]}</span>
                {Array.isArray(sel) && (
                  <span className="text-xs text-muted-foreground">
                    {sel.length} code{sel.length === 1 ? '' : 's'}
                  </span>
                )}
              </label>
            )
          })}
          {extraCount > 0 && (
            <p className="text-xs text-muted-foreground">
              +{extraCount} other code{extraCount === 1 ? '' : 's'} checked
            </p>
          )}
          <div className="relative pt-1">
            <Search className="absolute top-1/2 left-2 mt-0.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search codes… (048, 001, warehouse)"
              className="h-8 pl-7 text-xs"
            />
          </div>
          {isFetching && <p className="text-xs text-muted-foreground">Loading codes…</p>}
          {visibleEntries.length > 0 && (
            <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
              {visibleEntries.map((e) => (
                <label
                  key={e.key}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-accent/50"
                  title={`${e.description} — ${CATEGORY_LABELS[e.category]}`}
                >
                  <Checkbox checked={entryChecked(e)} onCheckedChange={() => toggleEntry(e)} />
                  <span className="shrink-0 tabular-nums">{e.code}</span>
                  {e.county ? (
                    <span className="truncate text-xs text-muted-foreground italic">{e.county}</span>
                  ) : (
                    <span className="truncate text-xs text-muted-foreground">{e.description}</span>
                  )}
                  {e.count > 0 && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                      {e.count.toLocaleString()}
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
          {!isFetching && search.trim() && visibleEntries.length === 0 && (
            <p className="text-xs text-muted-foreground">No code matches “{search.trim()}”.</p>
          )}
          {dorSelectionActive(selection) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() =>
                onChange(DOR_SELECTION_DEFAULT)
              }
            >
              Clear codes
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
