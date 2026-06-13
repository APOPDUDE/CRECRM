import { useState } from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { toast } from 'sonner'
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
import { useContacts, useCreateContact, contactNameOf } from '@/hooks/use-contacts'
import { cn } from '@/lib/utils'

interface ContactSelectProps {
  value: string | null
  onChange: (contactId: string | null) => void
  /** When set, a contact created inline is attached to this company. */
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
  const { data: contacts = [] } = useContacts()
  const createContact = useCreateContact()

  const selected = contacts.find((c) => c.id === value)
  const query = search.trim()
  const canCreate =
    query.length > 0 &&
    !contacts.some((c) => contactNameOf(c).toLowerCase() === query.toLowerCase())

  const handleCreate = () => {
    // first token → first name, remainder → last name (good enough for quick-add)
    const [first, ...rest] = query.split(/\s+/)
    createContact.mutate(
      { first_name: first, last_name: rest.join(' ') || null, company_id: companyId ?? null },
      {
        onSuccess: (contact) => {
          onChange(contact.id)
          setOpen(false)
          setSearch('')
          toast.success(`Contact "${query}" created`)
        },
        onError: () => toast.error('Could not create contact'),
      },
    )
  }

  return (
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
            <CommandEmpty>{query ? 'No matching contacts' : 'No contacts yet'}</CommandEmpty>
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
            {canCreate && (
              <CommandGroup forceMount>
                <CommandItem
                  value={`__create__${query}`}
                  forceMount
                  disabled={createContact.isPending}
                  onSelect={handleCreate}
                >
                  <Plus className="size-4" />
                  Create &ldquo;{query}&rdquo;
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
