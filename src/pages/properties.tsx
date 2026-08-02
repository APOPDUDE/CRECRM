import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Columns3, Crosshair, Download, List, Map as MapIcon, MoreHorizontal, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { PropertiesMap, type MapColorBy } from '@/components/properties-map'
import { dealCount, useDeleteProperty, useGeocodeMissing, useProperties } from '@/hooks/use-properties'
import type { Property, PropertyWithCounts } from '@/hooks/use-properties'
import type { OwnerContext } from '@/hooks/use-owners'
import { useGoodDealIds, useExecutedPropertyIds } from '@/hooks/use-market'
import { useOwnerContext } from '@/hooks/use-owners'
import { useCurrentAsking, type CurrentAsking } from '@/hooks/use-comps'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { supabase } from '@/lib/supabase'
import { friendlyDbError } from '@/lib/db-errors'
import { formatCurrency, formatPsf, formatSf } from '@/lib/format'
import { pointInPolygon, type LatLng } from '@/lib/geo'
import { downloadCsv, toCsv, todayStamp } from '@/lib/export-csv'

/** $14.50 PSF (lease) or $5,200,000 (sale) — from the property's current asking comp. */
function askingLabel(a: CurrentAsking | undefined): string | null {
  return formatPsf(a?.rate) ?? formatCurrency(a?.price)
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

// --- Configurable list columns -------------------------------------------------
// Address is always shown (the row's identity). Everything below is opt-in, capped
// at MAX_COLUMNS so the table stays readable; the choice is persisted per-browser.
type ColumnId =
  | 'type' | 'location' | 'city' | 'county' | 'size' | 'building_sf'
  | 'land_acres' | 'asking' | 'deals' | 'market_status' | 'days_on_market'
  | 'year_built' | 'zoning' | 'occupancy'
  | 'owner' | 'owner_contact' | 'portfolio' | 'last_contacted' | 'off_market_days'

type ColumnDef = {
  id: ColumnId
  label: string
  className?: string
  cell: (
    p: PropertyWithCounts,
    asking: CurrentAsking | undefined,
    owner: OwnerContext | undefined,
  ) => ReactNode
}

const MUTED = 'text-muted-foreground'

const COLUMN_DEFS: ColumnDef[] = [
  { id: 'type', label: 'Type', cell: (p) => <PropertyTypeBadge type={p.property_type} /> },
  { id: 'location', label: 'Location', className: MUTED, cell: (p) => formatLocation(p) },
  { id: 'city', label: 'City', className: MUTED, cell: (p) => p.city ?? '' },
  { id: 'county', label: 'County', className: MUTED, cell: (p) => p.county ?? '' },
  { id: 'size', label: 'Size', className: MUTED, cell: (p) => sizeLabel(p) ?? '' },
  { id: 'building_sf', label: 'Building SF', className: MUTED, cell: (p) => formatSf(p.building_sf) ?? '' },
  { id: 'land_acres', label: 'Acres', className: MUTED, cell: (p) => (p.land_acres != null ? `${p.land_acres} AC` : '') },
  { id: 'asking', label: 'Asking', className: MUTED, cell: (_p, asking) => askingLabel(asking) ?? '' },
  {
    id: 'deals',
    label: 'Deals',
    cell: (p) =>
      dealCount(p) > 0 ? (
        <Badge variant="secondary" className="font-normal">
          {dealCount(p)}
        </Badge>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
  },
  { id: 'market_status', label: 'Market status', className: MUTED, cell: (p) => (p.listing_status === 'off_market' ? 'Off market' : 'On market') },
  { id: 'days_on_market', label: 'Days on market', className: MUTED, cell: (p) => (p.days_on_market != null ? String(p.days_on_market) : '') },
  { id: 'year_built', label: 'Year built', className: MUTED, cell: (p) => (p.year_built != null ? String(p.year_built) : '') },
  { id: 'zoning', label: 'Zoning', className: MUTED, cell: (p) => p.zoning_description ?? p.zoning_district ?? '' },
  { id: 'occupancy', label: 'Occupancy', className: MUTED, cell: (p) => p.occupancy ?? '' },
  { id: 'owner', label: 'Owner', className: MUTED, cell: (_p, _a, o) => o?.owner_name ?? '' },
  {
    id: 'owner_contact',
    label: 'Verified owner',
    cell: (_p, _a, o) =>
      o?.owner_contact_verified ? (
        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Verified</Badge>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    className: MUTED,
    cell: (_p, _a, o) => ((o?.owner_property_count ?? 0) > 1 ? `${o!.owner_property_count} props` : ''),
  },
  {
    id: 'last_contacted',
    label: 'Last contacted',
    className: MUTED,
    cell: (_p, _a, o) => (o?.last_contacted_at ? new Date(o.last_contacted_at).toLocaleDateString() : ''),
  },
  {
    id: 'off_market_days',
    label: 'Days off market',
    className: MUTED,
    // "Never listed" is the interesting cohort for cold outreach; a number means the
    // sweep saw it listed and watched it disappear.
    cell: (p, _a, o) =>
      p.listing_status !== 'off_market' ? ''
        : o?.off_market_days != null ? `${o.off_market_days}d`
        : o?.was_on_market ? 'recent'
        : 'never listed',
  },
]

const DEFAULT_COLUMNS: ColumnId[] = ['type', 'location', 'size', 'asking', 'deals']
/** Address is fixed, so 6 here = 7 visible columns total. */
const MAX_COLUMNS = 6
/** Rows per page in the table — keeps the DOM light even with thousands of properties. */
const PAGE_SIZE = 100

export function PropertiesPage() {
  const navigate = useNavigate()
  const { data: properties, isLoading, isError, refetch } = useProperties()
  const { data: goodDealIds } = useGoodDealIds()
  const { data: executedIds } = useExecutedPropertyIds()
  const { data: askingMap } = useCurrentAsking()
  const { data: ownerCtx } = useOwnerContext()
  const deleteProperty = useDeleteProperty()
  // background-drain the lat/lng backfill (25/visit, Nominatim-throttled) so scrape rows
  // without coordinates progressively gain map pins. No-op once everything is geocoded.
  useGeocodeMissing()

  const [search, setSearch] = useState('')
  // Filters + column choice persist across navigation (sticky) so returning from a
  // property detail keeps the list exactly as it was.
  const [status, setStatus] = usePersistentState('properties:status', 'all')
  const [dealType, setDealType] = usePersistentState('properties:dealType', 'all')
  const [ptype, setPtype] = usePersistentState('properties:ptype', 'all')
  const [county, setCounty] = usePersistentState('properties:county', 'all')
  const [sfMin, setSfMin] = usePersistentState('properties:sfMin', '')
  const [sfMax, setSfMax] = usePersistentState('properties:sfMax', '')
  const [acMin, setAcMin] = usePersistentState('properties:acMin', '')
  const [acMax, setAcMax] = usePersistentState('properties:acMax', '')
  const [priceMin, setPriceMin] = usePersistentState('properties:priceMin', '')
  const [priceMax, setPriceMax] = usePersistentState('properties:priceMax', '')
  const [columns, setColumns] = usePersistentState<ColumnId[]>('properties:columns', DEFAULT_COLUMNS)
  const [ownerFilterRaw, setOwnerFilter] = usePersistentState('properties:owner', 'all')
  // the filter used to have 4 tiers; a persisted legacy value ('any'/'known'/'none') would
  // render an empty select and silently filter nothing — normalize it to 'all'
  const ownerFilter = ['all', 'verified', 'unverified'].includes(ownerFilterRaw)
    ? ownerFilterRaw
    : 'all'
  const [view, setView] = usePersistentState<'table' | 'map'>('properties:view', 'table')
  const [colorBy, setColorBy] = usePersistentState<MapColorBy>('properties:colorBy', 'market')
  const [page, setPage] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Property | null>(null)
  const [deleting, setDeleting] = useState<Property | null>(null)
  // Shape search: draw a polygon on the map. The completed shape lives here (not in the
  // map) because it also filters the table and drives the skip-trace export. The draft is
  // ephemeral on purpose — a half-drawn shape should not survive navigation.
  const [polygon, setPolygon] = usePersistentState<LatLng[] | null>('properties:shape', null)
  const [draft, setDraft] = useState<LatLng[] | null>(null)
  const drawMode = draft !== null

  // Guard against a tampered/legacy localStorage value that isn't an array.
  const safeColumns = Array.isArray(columns) ? columns : DEFAULT_COLUMNS
  // Render in registry order, filtered to the chosen set (so 'size'->'acres' is just a swap).
  const visibleColumns = COLUMN_DEFS.filter((c) => safeColumns.includes(c.id))
  const toggleColumn = (id: ColumnId) =>
    setColumns((cur) => {
      const arr = Array.isArray(cur) ? cur : DEFAULT_COLUMNS
      return arr.includes(id)
        ? arr.filter((c) => c !== id)
        : arr.length >= MAX_COLUMNS
          ? arr
          : [...arr, id]
    })

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
      // 'executed' is a lens on OUR deals, not a listing_status value — hence its own branch.
      if (status === 'executed') {
        if (!executedIds?.has(p.id)) return false
      } else if (status !== 'all' && (p.listing_status ?? 'on_market') !== status) return false
      // For lease / for sale comes from the current asking comp (a property can be both).
      if (dealType !== 'all') {
        const ask = askingMap?.get(p.id)
        if (dealType === 'lease' && ask?.rate == null) return false
        if (dealType === 'sale' && ask?.price == null) return false
      }
      // Binary on purpose (Alex): either we can call the owner today, or the parcel goes on
      // the next skip-trace list — county-known-but-uncalled is still "not verified".
      if (ownerFilter !== 'all') {
        const verified = !!ownerCtx?.get(p.id)?.owner_contact_verified
        if (ownerFilter === 'verified' && !verified) return false
        if (ownerFilter === 'unverified' && verified) return false
      }
      if (ptype !== 'all' && p.property_type !== ptype) return false
      if (county !== 'all' && p.county !== county) return false
      if (sfLo != null && (p.building_sf == null || p.building_sf < sfLo)) return false
      if (sfHi != null && (p.building_sf == null || p.building_sf > sfHi)) return false
      if (acLo != null && (p.land_acres == null || p.land_acres < acLo)) return false
      if (acHi != null && (p.land_acres == null || p.land_acres > acHi)) return false
      if (prLo != null || prHi != null) {
        const price = askingMap?.get(p.id)?.price ?? null
        if (prLo != null && (price == null || price < prLo)) return false
        if (prHi != null && (price == null || price > prHi)) return false
      }
      // Shape last: it's the most expensive test, so everything cheap rejects first.
      if (polygon && polygon.length >= 3 && !pointInPolygon(polygon, p.lat, p.lng)) return false
      return true
    })
  }, [properties, askingMap, ownerCtx, ownerFilter, executedIds, search, status, dealType, ptype, county, sfMin, sfMax, acMin, acMax, priceMin, priceMax, polygon])

  // Reset to the first page whenever a filter/search edit changes the result set.
  useEffect(() => {
    setPage(0)
  }, [search, status, dealType, ownerFilter, ptype, county, sfMin, sfMax, acMin, acMax, priceMin, priceMax, polygon])

  /**
   * Skip-trace hand-off: the current filtered set as CSV. Parcel ID leads because it is the
   * join key that has to survive Terrakotta and GHL and come back to the right owner.
   */
  const exportCsv = () => {
    const headers = [
      'Parcel ID', 'Address', 'City', 'State', 'Zip', 'County',
      'Owner Name', 'Owner Mailing Address', 'Property Type', 'Building SF', 'Acres',
      'Year Built', 'Last Sale Date', 'Last Sale Price',
      'Market Status', 'Was On Market', 'Days Off Market',
      'Owner Verified', 'Known Contacts', 'Last Contacted', 'CRM Property ID',
    ]
    const rows = filtered.map((p) => {
      const o = ownerCtx?.get(p.id)
      return [
        p.parcel_number, p.address, p.city, p.state, p.zip, p.county,
        o?.owner_name ?? p.owner_name, p.owner_mailing_address,
        p.property_type ? propertyKindLabels[p.property_type] : null,
        p.building_sf, p.land_acres, p.year_built,
        p.last_sale_date, p.last_sale_price,
        p.listing_status === 'off_market' ? 'off market' : 'on market',
        // "never" vs "was listed" is the split that matters for cold lists
        o?.was_on_market ? 'yes' : 'never',
        o?.off_market_days ?? '',
        o?.owner_contact_verified ? 'yes' : 'no',
        o?.owner_contact_count ?? 0,
        o?.last_contacted_at ? new Date(o.last_contacted_at).toISOString().slice(0, 10) : null,
        p.id,
      ]
    })
    downloadCsv(`skiptrace-${todayStamp()}-${rows.length}.csv`, toCsv(headers, rows))
    // Stamp the pipeline: these owners are now "out for skip-trace", so the map can show
    // what's already in flight and the next export can exclude them. Fire-and-forget —
    // the download must not hinge on the write.
    void supabase
      .rpc('mark_owners_exported', { p_property_ids: filtered.map((p) => p.id) })
      .then(({ data, error }) => {
        if (error) {
          toast.error('Export downloaded, but marking owners as exported failed.')
        } else {
          const n = (data as { owners_marked?: number } | null)?.owners_marked ?? 0
          if (n > 0) toast.success(`${n} owner${n === 1 ? '' : 's'} marked as exported`)
        }
      })
  }

  // Paginate the table display (data is fully loaded; this just bounds the DOM).
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  const activeFilterCount =
    (status !== 'all' ? 1 : 0) +
    (dealType !== 'all' ? 1 : 0) +
    (ptype !== 'all' ? 1 : 0) +
    (ownerFilter !== 'all' ? 1 : 0) +
    (county !== 'all' ? 1 : 0) +
    (sfMin || sfMax ? 1 : 0) +
    (acMin || acMax ? 1 : 0) +
    (priceMin || priceMax ? 1 : 0)

  const clearFilters = () => {
    setStatus('all')
    setPtype('all')
    setOwnerFilter('all')
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
          <div className="inline-flex shrink-0 overflow-hidden rounded-md border">
            <Button
              variant={view === 'table' ? 'secondary' : 'ghost'}
              size="sm"
              className="rounded-none"
              onClick={() => setView('table')}
              title="Table view"
            >
              <List className="size-4" />
              <span className="hidden lg:inline">Table</span>
            </Button>
            <Button
              variant={view === 'map' ? 'secondary' : 'ghost'}
              size="sm"
              className="rounded-none border-l"
              onClick={() => setView('map')}
              title="Map view"
            >
              <MapIcon className="size-4" />
              <span className="hidden lg:inline">Map</span>
            </Button>
          </div>
          {/* Which question the pin colours answer: "is it listed" vs "can we reach the owner". */}
          {view === 'map' && (
            <div className="inline-flex shrink-0 overflow-hidden rounded-md border">
              <Button
                variant={colorBy === 'market' ? 'secondary' : 'ghost'}
                size="sm"
                className="rounded-none"
                onClick={() => setColorBy('market')}
                title="Colour pins by market status"
              >
                Market
              </Button>
              <Button
                variant={colorBy === 'owner' ? 'secondary' : 'ghost'}
                size="sm"
                className="rounded-none border-l"
                onClick={() => setColorBy('owner')}
                title="Colour pins by whether we can reach the owner"
              >
                Owner
              </Button>
            </div>
          )}
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
                    <SelectItem value="executed">Executed (mine)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Lease / sale</Label>
                <Select value={dealType} onValueChange={setDealType}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="lease">For lease</SelectItem>
                    <SelectItem value="sale">For sale</SelectItem>
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
                <Label>Verified owner</Label>
                <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any</SelectItem>
                    <SelectItem value="verified">Verified</SelectItem>
                    <SelectItem value="unverified">Not verified</SelectItem>
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
          {view === 'table' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="hidden md:inline-flex">
                <Columns3 className="size-4" />
                <span className="hidden lg:inline">Columns</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Columns (up to {MAX_COLUMNS})</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLUMN_DEFS.map((c) => {
                const checked = safeColumns.includes(c.id)
                return (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={checked}
                    disabled={!checked && safeColumns.length >= MAX_COLUMNS}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={() => toggleColumn(c.id)}
                  >
                    {c.label}
                  </DropdownMenuCheckboxItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          )}
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
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No properties yet — use “Add property” above to add the buildings and land you're working.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No properties match “{search.trim()}”</p>
        </div>
      ) : view === 'map' ? (
        <div className="space-y-2">
          {/* Shape search: click the map to drop vertices, Finish closes the polygon. */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2">
            {!drawMode ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setPolygon(null); setDraft([]) }}
              >
                <Crosshair className="size-4" />
                {polygon ? 'Redraw shape' : 'Draw shape'}
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  disabled={(draft?.length ?? 0) < 3}
                  onClick={() => { setPolygon(draft); setDraft(null) }}
                >
                  Finish shape{draft && draft.length > 0 ? ` (${draft.length})` : ''}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={(draft?.length ?? 0) === 0}
                  onClick={() => setDraft((d) => (d && d.length > 0 ? d.slice(0, -1) : d))}
                >
                  Undo point
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              </>
            )}
            {polygon && !drawMode && (
              <Button size="sm" variant="ghost" onClick={() => setPolygon(null)}>
                Clear
              </Button>
            )}
            <span className="ml-auto text-sm text-muted-foreground">
              {drawMode
                ? (draft?.length ?? 0) < 3
                  ? 'Click the map to outline your search area (3+ points)'
                  : `${draft!.length} points — keep clicking or Finish`
                : polygon
                  ? `${filtered.length.toLocaleString()} in shape`
                  : `${filtered.length.toLocaleString()} matching`}
            </span>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
              <Download className="size-4" />
              Export CSV
            </Button>
          </div>
          <PropertiesMap
            properties={filtered}
            goodDealIds={goodDealIds}
            executedIds={executedIds}
            ownerContext={ownerCtx}
            colorBy={colorBy}
            polygon={polygon}
            draft={draft}
            drawMode={drawMode}
            onAddVertex={(lat, lng) => setDraft((d) => [...(d ?? []), { lat, lng }])}
          />
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  {visibleColumns.map((c) => (
                    <TableHead key={c.id}>{c.label}</TableHead>
                  ))}
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((property) => (
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
                    {visibleColumns.map((c) => (
                      <TableCell key={c.id} className={c.className}>
                        {c.cell(property, askingMap?.get(property.id), ownerCtx?.get(property.id))}
                      </TableCell>
                    ))}
                    <TableCell>{rowMenu(property)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {paged.map((property) => (
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
                    {askingLabel(askingMap?.get(property.id)) && (
                      <span>{askingLabel(askingMap?.get(property.id))}</span>
                    )}
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

          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-xs text-muted-foreground tabular-nums">
                {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of{' '}
                {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="size-4" />
                  Prev
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Page {safePage + 1} of {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
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
