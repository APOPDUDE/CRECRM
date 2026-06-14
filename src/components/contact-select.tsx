import { useState } from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ContactFormDialog } from '@/components/contact-form-dialog'
import { useContacts, contactNameOf } from '@/hooks/use-contacts'
import { cn } from '@/lib/utils'

interface ContactSelectProps {
  value: string | null
  onChange: (contactId: string | null) => void
  /** When set, a contact created from the picker is attached to this company. */
  companyId?: string | null
  placeholder?: string
}

export function ContactSelect({
  value,
  onChange,
  companyId,
  placeholder = 'Select contact',
}: ContactSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const { data: contacts = [] } = useContacts()

  const selected = contacts.find((c) => c.id === value)

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
            <span className={cn(!selected && 'text-muted-foreground')}>
              {selected ? contactNameOf(selected) : placeholder}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command>
            <CommandInput placeholder="Search contacts…" value={search} onValueChange={setSearch} />
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
              <CommandEmpty>
                {search.trim() ? 'No matching contacts' : 'No contacts yet'}
              </CommandEmpty>
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
                    value={`${contactNameOf(contact)} ${contact.id}`}
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
                    {contact.company && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {contact.company.name}
                      </span>
                    )}
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
