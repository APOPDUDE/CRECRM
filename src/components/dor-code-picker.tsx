import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useDorCodes, type DorCodeEntry } from '@/hooks/use-dor-codes'

const CATEGORY_LABELS: Record<DorCodeEntry['category'], string> = {
  industrial: 'Industrial',
  office: 'Office',
  retail: 'Retail',
  multifamily: 'Multifamily',
  other: 'Other',
}

/** The codes worth offering before anyone types: Alex's industrial-relevant set. */
const PRELISTED = ['040', '041', '042', '043', '044', '045', '046', '047', '048', '049', '027', '010', '001', '000', '002']

/**
 * The DOR-code picker (War Room overhaul Phase 3): a checkbox multi-select of county
 * use codes. Hover any code for its description plus ONE of five general categories —
 * not the counties' "crazy options". Search finds the rest, including county-specific
 * custom codes (values that don't normalize to the FDOR 000-099 list), shown with the
 * county in faint italics; those match verbatim against that county's rows only.
 */
export function DorCodePicker({
  checked,
  onChange,
}: {
  checked: string[]
  onChange: (next: string[]) => void
}) {
  const [expanded, setExpanded] = useState(checked.length > 0)
  const [search, setSearch] = useState('')
  const { data: entries = [], isFetching } = useDorCodes(expanded)
  const checkedSet = useMemo(() => new Set(checked), [checked])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q) {
      // codes lead (prefix first), descriptions/categories join the match
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
    // untyped: what's already checked, then the industrial-relevant standards
    const preset = entries.filter((e) => checkedSet.has(e.key) || PRELISTED.includes(e.key))
    return preset.sort(
      (a, b) =>
        Number(checkedSet.has(b.key)) - Number(checkedSet.has(a.key)) ||
        PRELISTED.indexOf(a.key) - PRELISTED.indexOf(b.key),
    )
  }, [entries, search, checkedSet])

  const toggle = (key: string) =>
    onChange(checked.includes(key) ? checked.filter((k) => k !== key) : [...checked, key])

  return (
    <div className="space-y-2 text-sm">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 font-medium"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        County use (DOR)
        {checked.length > 0 && (
          <span className="text-xs font-normal text-muted-foreground">
            {checked.length} code{checked.length === 1 ? '' : 's'}
          </span>
        )}
      </button>
      {expanded && (
        <div className="space-y-1.5 pl-1.5">
          <div className="relative">
            <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search codes… (048, warehouse)"
              className="h-8 pl-7 text-xs"
            />
          </div>
          {isFetching && <p className="text-xs text-muted-foreground">Loading codes…</p>}
          {visible.length > 0 && (
            <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
              {visible.map((e) => (
                <label
                  key={e.key}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-accent/50"
                  title={`${e.description} — ${CATEGORY_LABELS[e.category]}`}
                >
                  <Checkbox checked={checkedSet.has(e.key)} onCheckedChange={() => toggle(e.key)} />
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
          {!isFetching && search.trim() && visible.length === 0 && (
            <p className="text-xs text-muted-foreground">No code matches “{search.trim()}”.</p>
          )}
          {checked.length > 0 && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onChange([])}>
              Clear codes
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
