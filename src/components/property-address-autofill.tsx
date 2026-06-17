import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { useProperties } from '@/hooks/use-properties'
import type { Tables } from '@/lib/database.types'

type Property = Tables<'properties'>

interface PropertyAddressAutofillProps {
  value: string
  onChange: (value: string) => void
  /** Fired when an existing property is chosen — prefill + upsert by address. */
  onPick: (property: Property) => void
  id?: string
  placeholder?: string
  autoFocus?: boolean
}

/**
 * Address-first property lookup. Type an address; pick an existing property
 * (a scraped listing or one you already have) to autofill the rest. On submit
 * the RPC dedupes by address, so picking upserts instead of duplicating.
 */
export function PropertyAddressAutofill({
  value,
  onChange,
  onPick,
  id,
  placeholder,
  autoFocus,
}: PropertyAddressAutofillProps) {
  const { data: properties = [] } = useProperties()
  const [open, setOpen] = useState(false)

  const q = value.trim().toLowerCase()

  const matches = useMemo(() => {
    if (q.length < 3) return []
    return properties
      .filter((p) => {
        const hay = [p.address, p.city, p.state].filter(Boolean).join(' ').toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 8)
  }, [properties, q])

  return (
    <div className="relative">
      <Input
        id={id}
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {matches.map((p) => {
            const secondary = [p.city, p.state].filter(Boolean).join(', ')
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onPick(p)
                    setOpen(false)
                  }}
                >
                  <span className="font-medium">{p.address}</span>
                  {secondary && <span className="text-xs text-muted-foreground">{secondary}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
