import { useState } from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ContactFormDialog } from '@/components/contact-form-dialog'
import {
  CONTACT_SEARCH_MIN,
  contactNameOf,
  useContact,
  useContactBook,
  useContactSearch,
} from '@/hooks/use-contacts'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { formatPhone } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ContactSelectProps {
  value: string | null
  onChange: (contactId: string | null) => void
  /** When set, a contact created from the picker is attached to this company. */
  companyId?: string | null
  placeholder?: string
  /**
   * Name to show for `value` until its contact is fetched — e.g. a buyer prefilled from the
   * GHL tag queue. Without it the trigger flashes "Select contact" and looks unset.
   */
  fallbackLabel?: string | null
}

export function ContactSelect({
  value,
  onChange,
  companyId,
  placeholder = 'Select contact',
  fallbackLabel,
}: ContactSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)

  // Typing searches the whole book in Postgres; an untouched picker just shows the top of it.
  // (It used to list one capped page of contacts and filter that in the browser, which meant
  // most of the book could not be picked at all.)
  const query = useDebouncedValue(search.trim(), 250)
  const searching = query.length >= CONTACT_SEARCH_MIN
  const book = useContactBook('alpha', 50)
  const results = useContactSearch(query, { limit: 50 })
  const contacts = searching ? (results.data ?? []) : (book.data?.rows ?? [])
  const isLoading = searching ? results.isLoading : book.isLoading
  const isError = searching ? results.isError : book.isError
  const refetch = searching ? results.refetch : book.refetch

  const { data: selected } = useContact(value ?? undefined)
  const label = selected ? contactNameOf(selected) : value && fallbackLabel ? fallbackLabel : null

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={cn(!label && 'text-muted-foreground')}>{label ?? placeholder}</span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          {/* Postgres has already done the matching — cmdk must not filter the results again,
              or a hit found by email or phone would be thrown away before it renders. */}
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Name, phone, email, company…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandGroup forceMount>
                <CommandItem
                  value="__create_contact__"
                  forceMount
                  onSelect={() => {
                    setOpen(false)
                    setFormOpen(true)
                  }}
                >
                  <Plus className="size-4" />
                  Create contact
                </CommandItem>
              </CommandGroup>
              {contacts.length === 0 && (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  {isError ? (
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="text-destructive">Couldn't load contacts</span>
                      <button
                        type="button"
                        className="text-xs underline underline-offset-2 hover:text-foreground"
                        onClick={() => refetch()}
                      >
                        Try again
                      </button>
                    </div>
                  ) : isLoading ? (
                    'Searching…'
                  ) : searching ? (
                    'No matching contacts'
                  ) : (
                    'No contacts yet'
                  )}
                </div>
              )}
              <CommandGroup>
                {value && (
                  <CommandItem
                    value="__clear__"
                    onSelect={() => {
                      onChange(null)
                      setOpen(false)
                      setSearch('')
                    }}
                  >
                    <span className="text-muted-foreground">No contact</span>
                  </CommandItem>
                )}
                {contacts.map((contact) => (
                  <CommandItem
                    key={contact.id}
                    value={contact.id}
                    onSelect={() => {
                      onChange(contact.id)
                      setOpen(false)
                      setSearch('')
                    }}
                  >
                    <Check
                      className={cn('size-4', value === contact.id ? 'opacity-100' : 'opacity-0')}
                    />
                    {contactNameOf(contact)}
                    {/* namesakes are common in this book, so show something that tells them
                        apart rather than only a company that may be missing */}
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {contact.company?.name ?? formatPhone(contact.phone) ?? ''}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <ContactFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultCompanyId={companyId ?? null}
        onCreated={(id) => onChange(id)}
      />
    </>
  )
}
