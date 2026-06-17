import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { formatCurrency, formatPsf, formatSf } from '@/lib/format'

export type InlineFieldKind = 'currency' | 'psf' | 'percent' | 'sf' | 'acres' | 'number'

function formatValue(kind: InlineFieldKind, value: number | null): string | null {
  if (value == null) return null
  switch (kind) {
    case 'currency':
      return formatCurrency(value)
    case 'psf':
      return formatPsf(value)
    case 'sf':
      return formatSf(value)
    case 'percent':
      return `${value}%`
    case 'acres':
      return `${value} AC`
    default:
      return value.toLocaleString('en-US')
  }
}

interface InlineEditFieldProps {
  label: string
  value: number | null
  kind: InlineFieldKind
  /** Persist the new value (null clears it). */
  onSave: (value: number | null) => Promise<void> | void
  full?: boolean
}

/**
 * A property-grid field you can click to edit in place. Enter or blur saves
 * via onSave; Escape cancels. Matches the read-only `Field` row visually.
 */
export function InlineEditField({ label, value, kind, onSave, full }: InlineEditFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const begin = () => {
    setDraft(value == null ? '' : String(value))
    setEditing(true)
  }

  const commit = async () => {
    if (saving) return
    const trimmed = draft.trim()
    let next = trimmed === '' ? null : Number(trimmed)
    if (next != null && !Number.isFinite(next)) {
      setEditing(false)
      return
    }
    // SF columns are integers
    if (next != null && kind === 'sf') next = Math.round(next)
    if (next === value) {
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

  const display = formatValue(kind, value)

  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">
        {editing ? (
          <input
            type="number"
            inputMode="decimal"
            step="any"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                setEditing(false)
              }
            }}
            className="w-full rounded-md border px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : (
          <button
            type="button"
            onClick={begin}
            className={`group/edit -mx-1 inline-flex max-w-full items-center gap-1 rounded px-1 text-left hover:bg-accent ${
              value == null ? 'text-muted-foreground' : ''
            }`}
            title="Click to edit"
          >
            <span className="truncate">{saving ? 'Saving…' : (display ?? '—')}</span>
            <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover/edit:opacity-50" />
          </button>
        )}
      </dd>
    </div>
  )
}
