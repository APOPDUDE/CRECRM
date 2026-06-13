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
import { useCompanies, useCreateCompany } from '@/hooks/use-companies'
import type { Enums } from '@/lib/database.types'
import { cn } from '@/lib/utils'

interface CompanySelectProps {
  value: string | null
  onChange: (companyId: string | null) => void
  /** Company type applied when a company is created inline. */
  defaultType?: Enums<'company_type'>
  placeholder?: string
}

export function CompanySelect({
  value,
  onChange,
  defaultType = 'other',
  placeholder = 'Select company',
}: CompanySelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { data: companies = [] } = useCompanies()
  const createCompany = useCreateCompany()

  const selected = companies.find((c) => c.id === value)
  const query = search.trim()
  const canCreate =
    query.length > 0 && !companies.some((c) => c.name.toLowerCase() === query.toLowerCase())

  const handleCreate = () => {
    createCompany.mutate(
      { name: query, type: defaultType },
      {
        onSuccess: (company) => {
          onChange(company.id)
          setOpen(false)
          setSearch('')
          toast.success(`Company "${company.name}" created`)
        },
        onError: () => toast.error('Could not create company'),
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
            {selected ? selected.name : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search companies…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{query ? 'No matching companies' : 'No companies yet'}</CommandEmpty>
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
                  <span className="text-muted-foreground">No company</span>
                </CommandItem>
              )}
              {companies.map((company) => (
                <CommandItem
                  key={company.id}
                  value={company.name}
                  onSelect={() => {
                    onChange(company.id)
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <Check
                    className={cn('size-4', value === company.id ? 'opacity-100' : 'opacity-0')}
                  />
                  {company.name}
                </CommandItem>
              ))}
            </CommandGroup>
            {canCreate && (
              <CommandGroup forceMount>
                <CommandItem
                  value={`__create__${query}`}
                  forceMount
                  disabled={createCompany.isPending}
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
