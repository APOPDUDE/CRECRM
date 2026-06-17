import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { useContacts, contactNameOf } from '@/hooks/use-contacts'
import type { Contact } from '@/hooks/use-contacts'
import { formatPhone } from '@/lib/format'

interface ContactPhoneAutofillProps {
  /** The phone string being typed (the contact's identity). */
  value: string
  onChange: (value: string) => void
  /** Fired when an existing contact is chosen from the suggestions. */
  onPick: (contact: Contact) => void
  id?: string
  placeholder?: string
  autoFocus?: boolean
}

/**
 * Phone-first contact lookup: type a number (or name) and pick an existing
 * contact to autofill the form. Phone is the contact's unique identity, so
 * picking — or just re-typing a known number — upserts instead of duplicating.
 */
export function ContactPhoneAutofill({
  value,
  onChange,
  onPick,
  id,
  placeholder = '941-806-8432',
  autoFocus,
}: ContactPhoneAutofillProps) {
  const { data: contacts = [] } = useContacts()
  const [open, setOpen] = useState(false)

  const q = value.trim().toLowerCase()
  const digits = value.replace(/\D/g, '')

  const matches = useMemo(() => {
    if (q.length < 2) return []
    return contacts
      .filter((c) => {
        const phoneDigits = (c.phone ?? '').replace(/\D/g, '')
        const byPhone = digits.length >= 2 && phoneDigits.includes(digits)
        const byName = contactNameOf(c).toLowerCase().includes(q)
        const byCompany = (c.company?.name ?? '').toLowerCase().includes(q)
        return byPhone || byName || byCompany
      })
      .slice(0, 6)
  }, [contacts, q, digits])

  return (
    <div className="relative">
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          onChange(formatPhone(value) ?? value)
          // delay so a suggestion's mousedown registers before we close
          setTimeout(() => setOpen(false), 150)
        }}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onPick(c)
                  setOpen(false)
                }}
              >
                <span className="font-medium">{contactNameOf(c)}</span>
                <span className="text-xs text-muted-foreground">
                  {formatPhone(c.phone) ?? 'no phone'}
                  {c.company?.name ? ` · ${c.company.name}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
