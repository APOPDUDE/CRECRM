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
import { useProperties, useCreateProperty } from '@/hooks/use-properties'
import { cn } from '@/lib/utils'

interface PropertySelectProps {
  value: string | null
  onChange: (propertyId: string | null) => void
  placeholder?: string
}

export function PropertySelect({
  value,
  onChange,
  placeholder = 'Select property',
}: PropertySelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { data: properties = [] } = useProperties()
  const createProperty = useCreateProperty()

  const selected = properties.find((p) => p.id === value)
  const query = search.trim()
  const canCreate =
    query.length > 0 &&
    !properties.some((p) => p.address.toLowerCase() === query.toLowerCase())

  const handleCreate = () => {
    // outside property, address only — city/state/etc. left null per spec
    createProperty.mutate(
      { address: query },
      {
        onSuccess: (property) => {
          onChange(property.id)
          setOpen(false)
          setSearch('')
          toast.success(`Property "${property.address}" created`)
        },
        onError: () => toast.error('Could not create property'),
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
            {selected ? selected.address : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search properties…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{query ? 'No matching properties' : 'No properties yet'}</CommandEmpty>
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
                  <span className="text-muted-foreground">No property</span>
                </CommandItem>
              )}
              {properties.map((property) => {
                const secondary = [property.city, property.state].filter(Boolean).join(', ')
                return (
                  <CommandItem
                    key={property.id}
                    value={`${property.address} ${property.city ?? ''} ${property.state ?? ''}`}
                    onSelect={() => {
                      onChange(property.id)
                      setOpen(false)
                      setSearch('')
                    }}
                  >
                    <Check
                      className={cn('size-4', value === property.id ? 'opacity-100' : 'opacity-0')}
                    />
                    <div className="min-w-0">
                      <div className="truncate">{property.address}</div>
                      {secondary && (
                        <div className="truncate text-xs text-muted-foreground">{secondary}</div>
                      )}
                    </div>
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {canCreate && (
              <CommandGroup forceMount>
                <CommandItem
                  value={`__create__${query}`}
                  forceMount
                  disabled={createProperty.isPending}
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
