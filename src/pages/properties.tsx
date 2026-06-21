import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MoreHorizontal, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PropertyFormDialog, propertyKindLabels } from '@/components/property-form-dialog'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { ListErrorState } from '@/components/list-error-state'
import { dealCount, useDeleteProperty, useProperties } from '@/hooks/use-properties'
import type { Property } from '@/hooks/use-properties'
import { useGoodDealIds } from '@/hooks/use-market'
import { friendlyDbError } from '@/lib/db-errors'
import { formatCurrency, formatPsf, formatSf } from '@/lib/format'

/** $14.50 PSF (lease) or $5,200,000 (sale) — whichever the property carries. */
function askingLabel(p: Pick<Property, 'asking_rate_psf' | 'asking_price'>): string | null {
  return formatPsf(p.asking_rate_psf) ?? formatCurrency(p.asking_price)
}

/** Building SF, falling back to land acres. */
function sizeLabel(p: Pick<Property, 'building_sf' | 'land_acres'>): string | null {
  return formatSf(p.building_sf) ?? (p.land_acres != null ? `${p.land_acres} AC` : null)
}

export function PropertyTypeBadge({ type }: { type: Property['property_type'] }) {
  if (!type) return null
  return (
    <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200">
      {propertyKindLabels[type]}
    </Badge>
  )
}

function formatLocation(property: Property) {
  return [property.city, property.state].filter(Boolean).join(', ')
}

export function PropertiesPage() {
  const navigate = useNavigate()
  const { data: properties, isLoading, isError, refetch } = useProperties()
  const { data: goodDealIds } = useGoodDealIds()
  const deleteProperty = useDeleteProperty()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [ptype, setPtype] = useState('all')
  const [county, setCounty] = useState('all')
  const [sfMin, setSfMin] = useState('')
  const [sfMax, setSfMax] = useState('')
  const [acMin, setAcMin] = useState('')
  const [acMax, setAcMax] = useState('')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Property | null>(null)
  const [deleting, setDeleting] = useState<Property | null>(null)

  // The county list is derived from the data (98% populated) so it only offers real values.
  const counties = useMemo(() => {
    const set = new Set<string>()
    for (const p of properties ?? []) if (p.county) set.add(p.county)
    return [...set].sort()
  }, [properties])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const n = (v: string) => {
      const x = parseFloat(v)
      return Number.isFinite(x) ? x : null
    }
    const sfLo = n(sfMin), sfHi = n(sfMax)
    const acLo = n(acMin), acHi = n(acMax)
    const prLo = n(priceMin), prHi = n(priceMax)
    return (properties ?? []).filter((p) => {
      if (
        q &&
        ![p.address, p.city, p.state, p.zip, p.specs, p.county, p.property_type ? propertyKindLabels[p.property_type] : null]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(q))
      )
        return false
      if (status !== 'all' && (p.listing_status ?? 'on_market') !== status) return false
      if (ptype !== 'all' && p.property_type !== ptype) return false
      if (county !== 'all' && p.county !== county) return false
      if (sfLo != null && (p.building_sf == null || p.building_sf < sfLo)) return false
      if (sfHi != null && (p.building_sf == null || p.building_sf > sfHi)) return false
      if (acLo != null && (p.land_acres == null || p.land_acres < acLo)) return false
      if (acHi != null && (p.land_acres == null || p.land_acres > acHi)) return false
      if (prLo != null && (p.asking_price == null || p.asking_price < prLo)) return false
      if (prHi != null && (p.asking_price == null || p.asking_price > prHi)) return false
      return true
    })
  }, [properties, search, status, ptype, county, sfMin, sfMax, acMin, acMax, priceMin, priceMax])

  const activeFilterCount =
    (status !== 'all' ? 1 : 0) +
    (ptype !== 'all' ? 1 : 0) +
    (county !== 'all' ? 1 : 0) +
    (sfMin || sfMax ? 1 : 0) +
    (acMin || acMax ? 1 : 0) +
    (priceMin || priceMax ? 1 : 0)

  const clearFilters = () => {
    setStatus('all')
    setPtype('all')
    setCounty('all')
    setSfMin('')
    setSfMax('')
    setAcMin('')
    setAcMax('')
    setPriceMin('')
    setPriceMax('')
  }

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (property: Property) => {
    setEditing(property)
    setFormOpen(true)
  }

  const confirmDelete = () => {
    if (!deleting) return
    deleteProperty.mutate(deleting.id, {
      onSuccess: () => {
        toast.success('Property deleted')
        setDeleting(null)
      },
      onError: (error) => {
        toast.error(friendlyDbError(error, 'Could not delete property'))
        setDeleting(null)
      },
    })
  }

  const rowMenu = (property: Property) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Actions for {property.address}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => openEdit(property)}>
          <Pencil className="size-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(property)}>
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Properties</h1>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search properties…"
              className="pl-9"
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <SlidersHorizontal className="size-4" />
                <span className="hidden sm:inline">Filters</span>
                {activeFilterCount > 0 && (
                  <Badge className="ml-1 h-5 min-w-5 justify-center rounded-full px-1 tabular-nums">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3">
              <div className="space-y-1.5">
                <Label>Market status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="on_market">On market</SelectItem>
                    <SelectItem value="off_market">Off market</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={ptype} onValueChange={setPtype}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {Object.entries(propertyKindLabels).map(([v, label]) => (
                      <SelectItem key={v} value={v}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>County</Label>
                <Select value={county} onValueChange={setCounty}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All counties</SelectItem>
                    {counties.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Building SF</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" inputMode="numeric" placeholder="Min" value={sfMin} onChange={(e) => setSfMin(e.target.value)} />
                  <span className="text-muted-foreground">–</span>
                  <Input type="number" inputMode="numeric" placeholder="Max" value={sfMax} onChange={(e) => setSfMax(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Land acres</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" inputMode="decimal" placeholder="Min" value={acMin} onChange={(e) => setAcMin(e.target.value)} />
                  <span className="text-muted-foreground">–</span>
                  <Input type="number" inputMode="decimal" placeholder="Max" value={acMax} onChange={(e) => setAcMax(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Asking price</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" inputMode="numeric" placeholder="Min" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} />
                  <span className="text-muted-foreground">–</span>
                  <Input type="number" inputMode="numeric" placeholder="Max" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end border-t pt-2">
                <Button variant="ghost" size="sm" onClick={clearFilters} disabled={activeFilterCount === 0}>
                  Clear all
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">Add property</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </div>
      </div>

      {!isLoading && !isError && (properties ?? []).length > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {(properties ?? []).length} properties
        </p>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ListErrorState message="Could not load properties." onRetry={() => refetch()} />
      ) : (properties ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No properties yet — add the buildings and land you're working.
          </p>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Add property
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No properties match “{search.trim()}”</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Asking</TableHead>
                  <TableHead>Deals</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((property) => (
                  <TableRow
                    key={property.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/properties/${property.id}`)}
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {property.address}
                        {goodDealIds?.has(property.id) && (
                          <Badge
                            variant="outline"
                            className="border-emerald-200 bg-emerald-50 font-medium text-emerald-700"
                          >
                            Deal
                          </Badge>
                        )}
                        {property.listing_status === 'off_market' && (
                          <Badge
                            variant="outline"
                            className="border-amber-200 bg-amber-50 font-medium text-amber-700"
                          >
                            Off market
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <PropertyTypeBadge type={property.property_type} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatLocation(property)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{sizeLabel(property) ?? ''}</TableCell>
                    <TableCell className="text-muted-foreground">{askingLabel(property) ?? ''}</TableCell>
                    <TableCell>
                      {dealCount(property) > 0 ? (
                        <Badge variant="secondary" className="font-normal">
                          {dealCount(property)}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{rowMenu(property)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filtered.map((property) => (
              <div
                key={property.id}
                className="flex items-center justify-between gap-2 rounded-lg border bg-card"
              >
                <Link to={`/properties/${property.id}`} className="flex min-w-0 flex-1 flex-col p-3">
                  <span className="truncate text-sm font-medium">{property.address}</span>
                  {formatLocation(property) && (
                    <span className="truncate text-xs text-muted-foreground">
                      {formatLocation(property)}
                    </span>
                  )}
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {askingLabel(property) && <span>{askingLabel(property)}</span>}
                    {sizeLabel(property) && <span>{sizeLabel(property)}</span>}
                    {dealCount(property) > 0 && (
                      <span>
                        {dealCount(property)} deal{dealCount(property) === 1 ? '' : 's'}
                      </span>
                    )}
                  </span>
                </Link>
                <div className="flex shrink-0 items-center gap-1 pr-3">
                  {goodDealIds?.has(property.id) && (
                    <Badge
                      variant="outline"
                      className="border-emerald-200 bg-emerald-50 font-medium text-emerald-700"
                    >
                      Deal
                    </Badge>
                  )}
                  {property.listing_status === 'off_market' && (
                    <Badge
                      variant="outline"
                      className="border-amber-200 bg-amber-50 font-medium text-amber-700"
                    >
                      Off
                    </Badge>
                  )}
                  <PropertyTypeBadge type={property.property_type} />
                  {rowMenu(property)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <PropertyFormDialog open={formOpen} onOpenChange={setFormOpen} property={editing} />
      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete property?"
        description={`“${deleting?.address}” will be permanently deleted. If it's linked to a listing or match, deletion will be blocked.`}
        pending={deleteProperty.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
