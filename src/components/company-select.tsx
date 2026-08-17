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
import { CompanyFormDialog, companyTypeLabels } from '@/components/company-form-dialog'
import {
  COMPANY_SEARCH_MIN,
  useCompany,
  useCompanyBook,
  useCompanySearch,
} from '@/hooks/use-companies'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
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

  // Typing searches the whole table in Postgres; an untouched picker just shows the top
  // of it. (It used to fetch "all" companies and filter in the browser — with ~24k rows
  // PostgREST silently returns the first 1000, so most companies could not be picked and
  // a freshly created one never appeared.)
  const query = useDebouncedValue(search.trim(), 250)
  const searching = query.length >= COMPANY_SEARCH_MIN
  const book = useCompanyBook(50)
  const results = useCompanySearch(query, 50)
  const companies = searching ? (results.data ?? []) : (book.data?.rows ?? [])
  const isLoading = searching ? results.isLoading : book.isLoading
  const isError = searching ? results.isError : book.isError
  const refetch = searching ? results.refetch : book.refetch

  // Resolved by id, so the trigger shows the right name even when the company is not in
  // the current page of the list — e.g. one created a moment ago from this picker.
  const { data: selected } = useCompany(value ?? undefined)

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
          {/* Postgres already matched — cmdk must not filter the results again. */}
          <Command shouldFilter={false}>
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
              {companies.length === 0 && (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  {isError ? (
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="text-destructive">Couldn't load companies</span>
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
                    'No matching companies'
                  ) : (
                    'No companies yet'
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
                    <span className="text-muted-foreground">No company</span>
                  </CommandItem>
                )}
                {companies.map((company) => (
                  <CommandItem
                    key={company.id}
                    value={company.id}
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
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {companyTypeLabels[company.type]}
                    </span>
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
