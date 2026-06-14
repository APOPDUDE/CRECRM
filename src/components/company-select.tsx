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
import { CompanyFormDialog } from '@/components/company-form-dialog'
import { useCompanies } from '@/hooks/use-companies'
import type { Enums } from '@/lib/database.types'
import { cn } from '@/lib/utils'

interface CompanySelectProps {
  value: string | null
  onChange: (companyId: string | null) => void
  /** Company type applied when a company is created from the picker. */
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
  const [formOpen, setFormOpen] = useState(false)
  const { data: companies = [] } = useCompanies()

  const selected = companies.find((c) => c.id === value)

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
              {selected ? selected.name : placeholder}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Search companies…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandGroup forceMount>
                <CommandItem
                  value="__create_company__"
                  forceMount
                  onSelect={() => {
                    setOpen(false)
                    setFormOpen(true)
                  }}
                >
                  <Plus className="size-4" />
                  Create company
                </CommandItem>
              </CommandGroup>
              <CommandEmpty>
                {search.trim() ? 'No matching companies' : 'No companies yet'}
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
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <CompanyFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultType={defaultType}
        onCreated={(id) => onChange(id)}
      />
    </>
  )
}
