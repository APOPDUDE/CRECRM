import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { formatCurrency, formatPsf, formatSf } from '@/lib/format'
import { formatDate } from '@/lib/dates'

export type InlineFieldKind =
  | 'text'
  | 'currency'
  | 'psf'
  | 'sf'
  | 'percent'
  | 'acres'
  | 'number'
  | 'select'
  | 'boolean'
  | 'date'

type Val = string | number | boolean | null
export interface InlineOption {
  value: string
  label: string
}

const NUMERIC: InlineFieldKind[] = ['currency', 'psf', 'sf', 'percent', 'acres', 'number']
// Kinds that get live thousands separators while typing (big / money values).
const GROUPED: InlineFieldKind[] = ['currency', 'psf', 'sf']

/** Format an in-progress numeric string with thousands commas, preserving a
 *  trailing decimal point and partial decimals as the user types. */
function formatWithCommas(raw: string): string {
  let s = String(raw ?? '').replace(/,/g, '').replace(/[^0-9.\-]/g, '')
  const neg = s.startsWith('-')
  s = s.replace(/-/g, '')
  const dot = s.indexOf('.')
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '')
  let [intPart = '', decPart] = s.split('.')
  intPart = intPart.replace(/^0+(?=\d)/, '')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  let out = grouped
  if (s.includes('.')) out += '.' + (decPart ?? '')
  return (neg ? '-' : '') + out
}

function displayValue(kind: InlineFieldKind, value: Val, options?: InlineOption[]): string | null {
  if (value == null || value === '') return null
  switch (kind) {
    case 'currency':
      return formatCurrency(Number(value))
    case 'psf':
      return formatPsf(Number(value))
    case 'sf':
      return formatSf(Number(value))
    case 'percent':
      return `${value}%`
    case 'acres':
      return `${value} AC`
    case 'number':
      return Number(value).toLocaleString('en-US')
    case 'date':
      return formatDate(String(value))
    case 'boolean':
      return value ? 'Yes' : 'No'
    case 'select':
      return options?.find((o) => o.value === String(value))?.label ?? String(value)
    default:
      return String(value)
  }
}

function toDraft(kind: InlineFieldKind, value: Val): string {
  if (value == null) return ''
  if (kind === 'boolean') return value ? 'true' : 'false'
  if (kind === 'date') return String(value).slice(0, 10)
  if (GROUPED.includes(kind)) return formatWithCommas(String(value))
  return String(value)
}

function parseDraft(kind: InlineFieldKind, draft: string): Val {
  let t = draft.trim()
  if (kind === 'boolean') return t === '' ? null : t === 'true'
  if (t === '') return null
  if (NUMERIC.includes(kind)) {
    t = t.replace(/,/g, '') // drop thousands separators before parsing
    const n = Number(t)
    if (!Number.isFinite(n)) return null
    return kind === 'sf' ? Math.round(n) : n
  }
  return t // text, date, select
}

interface InlineEditFieldProps {
  label: string
  value: Val
  kind: InlineFieldKind
  /** Options for kind="select". */
  options?: InlineOption[]
  /** Persist the new value (null clears it). Omit to render read-only. */
  onSave?: (value: Val) => Promise<void> | void
  full?: boolean
  /** Small muted note after the label, e.g. "auto". */
  note?: string
}

/** A property-grid field you can click to edit in place (any value type). */
export function InlineEditField({ label, value, kind, options, onSave, full, note }: InlineEditFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const begin = () => {
    if (!onSave) return
    setDraft(toDraft(kind, value))
    setEditing(true)
  }

  const commit = async (raw?: string) => {
    if (saving || !onSave) return
    const next = parseDraft(kind, raw !== undefined ? raw : draft)
    if (next === value || (next == null && (value == null || value === ''))) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(next)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  const shown = displayValue(kind, value, options)
  const inputCls =
    'w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-medium text-muted-foreground">
        {label}
        {note && <span className="ml-1 font-normal opacity-70">· {note}</span>}
      </dt>
      <dd className="mt-0.5 text-sm">
        {editing && onSave ? (
          kind === 'select' || kind === 'boolean' ? (
            <select
              autoFocus
              className={inputCls}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                void commit(e.target.value)
              }}
              onBlur={() => setEditing(false)}
            >
              <option value="">—</option>
              {(kind === 'boolean'
                ? [
                    { value: 'true', label: 'Yes' },
                    { value: 'false', label: 'No' },
                  ]
                : (options ?? [])
              ).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              autoFocus
              type={
                kind === 'date'
                  ? 'date'
                  : kind === 'text' || GROUPED.includes(kind)
                    ? 'text'
                    : 'number'
              }
              inputMode={kind === 'text' || kind === 'date' ? undefined : 'decimal'}
              step="any"
              className={inputCls}
              value={draft}
              onChange={(e) =>
                setDraft(GROUPED.includes(kind) ? formatWithCommas(e.target.value) : e.target.value)
              }
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void commit()
                } else if (e.key === 'Escape') {
                  setEditing(false)
                }
              }}
            />
          )
        ) : onSave ? (
          <button
            type="button"
            onClick={begin}
            title="Click to edit"
            className={`group/edit -mx-1 inline-flex max-w-full items-center gap-1 rounded px-1 text-left hover:bg-accent ${
              value == null || value === '' ? 'text-muted-foreground' : ''
            }`}
          >
            <span className="truncate">{saving ? 'Saving…' : (shown ?? '—')}</span>
            <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover/edit:opacity-50" />
          </button>
        ) : (
          <span className={value == null || value === '' ? 'text-muted-foreground' : ''}>
            {shown ?? '—'}
          </span>
        )}
      </dd>
    </div>
  )
}
