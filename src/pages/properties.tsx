import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { BadgeCheck, ChevronLeft, ChevronRight, Columns3, Download, List, Map as MapIcon, MoreHorizontal, Pencil, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { CurrencyInput } from '@/components/ui/currency-input'
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
import { PARCEL_ZOOM, PropertiesMap } from '@/components/properties-map'
import { MapFilterRail, type OwnerChannels } from '@/components/map-filter-rail'
import {
  PROPERTY_TAG_OPTIONS,
  safeTagFilter,
  useTaggedPropertyIds,
  type PropertyTagKey,
} from '@/hooks/use-property-tag-filter'
import { useLastSales } from '@/hooks/use-last-sales'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { dealCount, useDeleteProperty, useGeocodeMissing, useProperties } from '@/hooks/use-properties'
import {
  MAP_SEARCH_LIMIT,
  useMapProperties,
  useMapSearch,
  type MapViewport,
} from '@/hooks/use-map-properties'
import { useIndustrialCrossovers, isZonedIndustrial } from '@/hooks/use-zoning-map'
import {
  OVERLAY_DEFAULT, activeIncludes, activeOnlys, rowInOverlay, safeOverlayState, type OverlayState,
} from '@/lib/overlays'
import {
  DOR_FILTER_ORDER, DOR_SELECTION_DEFAULT, ZONING_FILTER_ORDER,
  dorBucket, dorBucketLabels, dorSelectionActive, isIndustrialUse, matchesDorSelection,
  safeDorSelection, zoningKindLabels, type DorSelection,
} from '@/lib/zoning'
import { DorCodePicker } from '@/components/dor-code-picker'
import { useDorCodes } from '@/hooks/use-dor-codes'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import type { Property, PropertyWithCounts } from '@/hooks/use-properties'
import type { OwnerContext } from '@/hooks/use-owners'
import { useGoodDealIds, useExecutedPropertyIds } from '@/hooks/use-market'
import { useOwnerContext } from '@/hooks/use-owners'
import { useCurrentAsking, type CurrentAsking } from '@/hooks/use-comps'
import { useLeaseComps, withinMonths, signedWithinMonths, type LeaseComp } from '@/hooks/use-lease-comps'
import { useAvailableUnitSizes } from '@/hooks/use-units'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { friendlyDbError } from '@/lib/db-errors'
import { formatCurrency, formatPhone, formatPsf, formatSf } from '@/lib/format'
import { pointInPolygon, type LatLng } from '@/lib/geo'
import { buildHaystack, matchesTokens, searchTokens } from '@/lib/address-search'
import { downloadCsv, toCsv, todayStamp } from '@/lib/export-csv'
import { PushToGhlDialog, type PushContact } from '@/components/push-to-ghl-dialog'
import { OwnerOutreachDialog, type OwnerRecipient } from '@/components/owner-outreach-dialog'
import { ExportDialog } from '@/components/export-dialog'

/** $14.50 PSF (lease) or $5,200,000 (sale) — from the property's current asking comp. */
function askingLabel(a: CurrentAsking | undefined): string | null {
  return formatPsf(a?.rate) ?? formatCurrency(a?.price)
}

/** Building SF, falling back to land acres. */
function sizeLabel(p: Pick<Property, 'gross_sf' | 'land_acres'>): string | null {
  return formatSf(p.gross_sf) ?? (p.land_acres != null ? `${p.land_acres} AC` : null)
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
  | 'type' | 'location' | 'city' | 'county' | 'size' | 'gross_sf'
  | 'land_acres' | 'asking' | 'deals' | 'market_status' | 'days_on_market'
  | 'year_built' | 'zoning' | 'occupancy'
  | 'owner' | 'owner_contact' | 'portfolio' | 'last_contacted' | 'off_market_days'
  | 'tenant' | 'decision_maker' | 'leased_sf' | 'lease_signed' | 'lease_rate' | 'lease_expiry'
  | 'suitability'

/** Columns that only mean anything while a lease window is filtering the list. */
const LEASE_COLUMNS: ColumnId[] = ['tenant', 'decision_maker', 'leased_sf', 'lease_signed', 'lease_rate', 'lease_expiry']

type ColumnDef = {
  id: ColumnId
  label: string
  className?: string
  cell: (
    p: PropertyWithCounts,
    asking: CurrentAsking | undefined,
    owner: OwnerContext | undefined,
    lease: LeaseComp | undefined,
  ) => ReactNode
}

const MUTED = 'text-muted-foreground'

const COLUMN_DEFS: ColumnDef[] = [
  { id: 'type', label: 'Type', cell: (p) => <PropertyTypeBadge type={p.property_type} /> },
  { id: 'location', label: 'Location', className: MUTED, cell: (p) => formatLocation(p) },
  { id: 'city', label: 'City', className: MUTED, cell: (p) => p.city ?? '' },
  { id: 'county', label: 'County', className: MUTED, cell: (p) => p.county ?? '' },
  { id: 'size', label: 'Size', className: MUTED, cell: (p) => sizeLabel(p) ?? '' },
  { id: 'gross_sf', label: 'Gross SF', className: MUTED, cell: (p) => formatSf(p.gross_sf) ?? '' },
  { id: 'land_acres', label: 'Acres', className: MUTED, cell: (p) => (p.land_acres != null ? `${p.land_acres} AC` : '') },
  {
    // Blank, not a dash and never a 0: a parcel with no published score is one the
    // enrichment pass has not reached, or one where too few factors were measured
    // to publish a number honestly. Both are "nothing to rank on", not "bad site".
    id: 'suitability',
    label: 'Site score',
    className: MUTED,
    cell: (p) => (p.suitability_score == null ? '' : Math.round(p.suitability_score)),
  },
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
  // Listing-event facts read the current asking comp (R7) — the properties columns are gone.
  { id: 'days_on_market', label: 'Days on market', className: MUTED, cell: (_p, asking) => (asking?.days_on_market != null ? String(asking.days_on_market) : '') },
  { id: 'year_built', label: 'Year built', className: MUTED, cell: (p) => (p.year_built != null ? String(p.year_built) : '') },
  { id: 'zoning', label: 'Zoning', className: MUTED, cell: (p) => p.zoning_description ?? p.zoning_district ?? '' },
  { id: 'occupancy', label: 'Occupancy', className: MUTED, cell: (_p, asking) => asking?.occupancy ?? '' },
  { id: 'owner', label: 'Owner', className: MUTED, cell: (_p, _a, o) => o?.owner_name ?? '' },
  {
    id: 'owner_contact',
    label: 'Verified owner',
    // Names the channel rather than a bare "Verified": one you can call today, the other
    // you can only write to, and the export/push behave differently for each.
    cell: (_p, _a, o) =>
      o?.owner_contact_verified ? (
        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Call</Badge>
      ) : o?.owner_email_verified ? (
        <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">Email</Badge>
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
    id: 'tenant',
    label: 'Tenant',
    className: MUTED,
    // The name opens the company — that page holds the contacts and the DM toggle, so
    // the table is two clicks from "lease expiring" to "person to call".
    cell: (_p, _a, _o, lease) =>
      lease?.tenant_name ? (
        lease.tenant_company_id ? (
          <Link
            to={`/companies/${lease.tenant_company_id}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-primary hover:underline"
          >
            {lease.tenant_name}
          </Link>
        ) : (
          lease.tenant_name
        )
      ) : (
        ''
      ),
  },
  {
    id: 'decision_maker',
    label: 'Decision maker',
    className: MUTED,
    cell: (_p, _a, _o, lease) => {
      if (!lease?.dm_name) return ''
      return (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          {lease.dm_verified && (
            <BadgeCheck className="size-3.5 shrink-0 text-blue-600" aria-label="Verified" />
          )}
          {lease.dm_name}
          {lease.dm_phone && (
            <span className="ml-1 text-xs opacity-70">{formatPhone(lease.dm_phone)}</span>
          )}
        </span>
      )
    },
  },
  {
    id: 'leased_sf',
    label: 'Leased SF',
    className: MUTED,
    // The unit, not the shell — the Size column already carries the building.
    cell: (_p, _a, _o, lease) => formatSf(lease?.sf) ?? '',
  },
  {
    id: 'lease_signed',
    label: 'Signed',
    className: MUTED,
    cell: (_p, _a, _o, lease) =>
      lease?.signed_date
        ? format(new Date(`${lease.signed_date}T00:00:00`), 'MMM yyyy')
        : '',
  },
  {
    id: 'lease_rate',
    label: 'Lease rate',
    className: MUTED,
    // The comp's own executed rate, not the parcel's current asking — that is the number
    // you price against.
    cell: (_p, _a, _o, lease) => {
      if (lease?.executed_lease_rate_psf == null) return ''
      return (
        <span className="whitespace-nowrap">
          {formatPsf(lease.executed_lease_rate_psf)}
          {lease.lease_structure && (
            <span className="ml-1 text-xs opacity-70">{lease.lease_structure}</span>
          )}
        </span>
      )
    },
  },
  {
    id: 'lease_expiry',
    label: 'Lease expires',
    className: MUTED,
    // The months figure is what the filter is expressed in, so it rides along with the
    // date — otherwise you have to do the arithmetic to check the row belongs here.
    cell: (_p, _a, _o, lease) => {
      if (!lease?.expiration_date) return ''
      const m = lease.months_to_expiry
      // months_to_expiry is floored, so 0 means "under a month out" — not "this calendar
      // month". A lease ending 1 Sep is 0 months away on 9 Aug, and calling that "this
      // month" would read as August.
      const rel = m == null ? null : m < 0 ? 'expired' : m === 0 ? '<1 mo' : `${m} mo`
      return (
        <span className="whitespace-nowrap">
          {format(new Date(`${lease.expiration_date}T00:00:00`), 'd MMM yyyy')}
          {rel && <span className="ml-1.5 text-xs opacity-70">({rel})</span>}
        </span>
      )
    },
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

/** A tampered/legacy persisted channels value must not strip both channels silently. */
function safeChannels(v: unknown): OwnerChannels {
  const o = (v ?? {}) as Partial<OwnerChannels>
  const phone = o.phone !== false
  const email = o.email !== false
  return phone || email ? { phone, email } : { phone: true, email: true }
}

const DEFAULT_COLUMNS: ColumnId[] = ['type', 'location', 'size', 'asking', 'deals']
/** Address is fixed, so 6 here = 7 visible columns total. */
const MAX_COLUMNS = 6
/** Rows per page in the table — keeps the DOM light even with thousands of properties. */
const PAGE_SIZE = 100

export function PropertiesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const deleteProperty = useDeleteProperty()
  // background-drain the lat/lng backfill (25/visit, Nominatim-throttled) so scrape rows
  // without coordinates progressively gain map pins. No-op once everything is geocoded.
  useGeocodeMissing()

  // Sticky like the filters: clicking into a property and coming back mid-canvass must
  // land on the same search, not a reset one (Alex, 2026-08-19). Guarded because a
  // tampered/legacy stored value that isn't a string would crash searchTokens.
  const [searchRaw, setSearch] = usePersistentState('properties:search', '')
  const search = typeof searchRaw === 'string' ? searchRaw : ''
  // Filters + column choice persist across navigation (sticky) so returning from a
  // property detail keeps the list exactly as it was.
  const [status, setStatus] = usePersistentState('properties:status', 'all')
  const [dealType, setDealType] = usePersistentState('properties:dealType', 'all')
  const [ptype, setPtype] = usePersistentState('properties:ptype', 'all')
  // The two-axis refinement (Alex 2026-08-15): USE = what the county records the parcel
  // as today (DOR code, bucketed), ZONING = what it is allowed to become. They compose —
  // "single family home but zoned industrial" is one pick on each axis. 'non_industrial'
  // is a first-class zoning value because the grandfathered cohort (used industrial,
  // not zoned for it) is a search he runs, not a negation he should have to build.
  const [zoningFilter, setZoningFilter] = usePersistentState('properties:zoning', 'all')
  const [useFilter, setUseFilter] = usePersistentState('properties:use', 'all')
  // Condo units are OUT of a market canvass by default (Alex 2026-08-19): 2,077
  // separately-owned units — 236 at the Motor Enclave alone — flood any area search.
  // The flag is `properties.is_condo_unit`, computed in Postgres (refresh_condo_units());
  // this toggle only decides whether the page shows them. Deliberately NOT part of
  // activeFilterCount: its default-on exclusion must not flip the bare map into the
  // whole-book fetch, so it lenses whatever set is already on screen instead.
  const [includeCondos, setIncludeCondos] = usePersistentState('properties:includeCondos', false)
  // Owner operators, tri-state (Alex 2026-08-20): in the set (default), out of it, or the
  // whole search. 'owner occupier' is the stored tag; "owner operator" is what Alex calls it.
  const [ownerOccModeRaw, setOwnerOccMode] = usePersistentState<'all' | 'hide' | 'only'>(
    'properties:ownerOccMode',
    'all',
  )
  const ownerOccMode = ownerOccModeRaw === 'hide' || ownerOccModeRaw === 'only' ? ownerOccModeRaw : 'all'
  // "Don't call people who just sold" (Alex 2026-08-20). Empty = off. Coverage is partial, so
  // no-sale-date properties stay visible unless the companion toggle is unchecked.
  const [soldYears, setSoldYears] = usePersistentState<string>('properties:soldYears', '')
  const [includeNoSale, setIncludeNoSale] = usePersistentState<boolean>('properties:includeNoSale', true)
  const soldYearsNum = parseFloat(soldYears)
  const soldFilterOn = Number.isFinite(soldYearsNum) && soldYearsNum > 0
  // The DOR picker's layers: four tri-state major categories + extra checked codes
  // (standard 'other' codes and county customs). ANDs with the bucketed use select.
  const [dorSelRaw, setDorSel] = usePersistentState<DorSelection>('properties:dorSel', DOR_SELECTION_DEFAULT)
  const dorSel = useMemo(() => safeDorSelection(dorSelRaw), [dorSelRaw])
  const dorActive = dorSelectionActive(dorSel)
  // A category on 'all' matches by the dor_codes table's filing — that mapping has to
  // be on hand for the filter, not just the picker.
  const { data: dorEntries } = useDorCodes(dorActive)
  const dorCategoryByCode = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of dorEntries ?? []) if (!e.county) m.set(e.code, e.category)
    return m
  }, [dorEntries])
  /** What the land-book's `land` DOR layer paints — dor_codes.land_class. */
  const dorLandCodes = useMemo(() => {
    const s = new Set<string>()
    for (const e of dorEntries ?? []) if (!e.county && e.landClass) s.add(e.code)
    return s
  }, [dorEntries])
  // Tags (Alex 2026-08-17): interested / not interested / owner operator / buyer, several
  // at once. Resolved to a set of property ids server-side rather than read off the rows,
  // because the four tags live in three different tables — see use-property-tag-filter.
  const [tagFilterRaw, setTagFilter] = usePersistentState<PropertyTagKey[]>('properties:tags', [])
  const tagFilter = useMemo(() => safeTagFilter(tagFilterRaw), [tagFilterRaw])
  const { tagIds, isLoading: tagsLoading } = useTaggedPropertyIds(tagFilter)
  const { tagIds: ownerOccIds } = useTaggedPropertyIds(
    ownerOccMode === 'all' ? [] : ['owner occupier'],
  )
  const { data: lastSales } = useLastSales(soldFilterOn)
  const [county, setCounty] = usePersistentState('properties:county', 'all')
  const { data: unitSizes } = useAvailableUnitSizes()
  const [sfMin, setSfMin] = usePersistentState('properties:sfMin', '')
  const [sfMax, setSfMax] = usePersistentState('properties:sfMax', '')
  const [acMin, setAcMin] = usePersistentState('properties:acMin', '')
  const [acMax, setAcMax] = usePersistentState('properties:acMax', '')
  const [priceMin, setPriceMin] = usePersistentState('properties:priceMin', '')
  const [priceMax, setPriceMax] = usePersistentState('properties:priceMax', '')
  // Lease pricing is $/SF/yr, sale pricing is a total — the rail SWITCHES between them
  // with the For lease / For sale choice (Alex), so they are separate state, never both.
  const [psfMin, setPsfMin] = usePersistentState('properties:psfMin', '')
  const [psfMax, setPsfMax] = usePersistentState('properties:psfMax', '')
  // Default ON: the map must not silently hide unpriced listings (Alex).
  const [includeUnpriced, setIncludeUnpriced] = usePersistentState('properties:includeUnpriced', true)
  // Which channels count while "Verified contact" is on: phone, email, or either.
  const [channelsRaw, setChannels] = usePersistentState<OwnerChannels>(
    'properties:ownerChannels',
    { phone: true, email: true },
  )
  const channels = useMemo(() => safeChannels(channelsRaw), [channelsRaw])
  const [columns, setColumns] = usePersistentState<ColumnId[]>('properties:columns', DEFAULT_COLUMNS)
  const [ownerFilterRaw, setOwnerFilter] = usePersistentState('properties:owner', 'all')
  // the filter used to have 4 tiers; a persisted legacy value ('any'/'known'/'none') would
  // render an empty select and silently filter nothing — normalize it to 'all'
  const ownerFilter = ['all', 'verified', 'unverified'].includes(ownerFilterRaw)
    ? ownerFilterRaw
    : 'all'
  // Same 30-day question the owner text blast asks ("Touched in 30d" / "Quiet 30d+"), lifted
  // out of that dialog so it also narrows the map and the table. A market-news touch suits
  // people you have spoken to; a cold opener is wasted on someone you rang last week.
  const [activityRaw, setActivity] = usePersistentState('properties:activity', 'all')
  const activity = ['all', 'recent', 'quiet'].includes(activityRaw) ? activityRaw : 'all'
  const ACTIVITY_DAYS = 30
  // Frozen per mount so the filter can't reshuffle rows under you as the clock ticks.
  const activityCutoff = useMemo(() => Date.now() - ACTIVITY_DAYS * 86400000, [])
  const [view, setView] = usePersistentState<'table' | 'map'>('properties:view', 'table')
  // Which book the War Room shows (Alex 2026-08-21): Industrial is the normal book
  // (just-land rows excluded so it never slows or clutters), Land is the developer-land
  // book. <=5% building-to-land crossovers appear in both. Server-side on every data
  // path — the book fetch, the viewport RPC and typed search all carry it.
  const [bookModeRaw, setBookMode] = usePersistentState<'industrial' | 'land'>('properties:book', 'industrial')
  const bookMode = bookModeRaw === 'land' ? 'land' : 'industrial'
  // "Search leases" (Alex, 2026-08-16): the lease windows live in the rail behind one
  // toggle — new listing lands, draw the area, flip this on, and every tenant close to
  // expiry nearby is on screen with their DM. On the map the windows only APPLY while
  // it's on; the table's popover shows them unconditionally, so there they always apply.
  const [searchLeases, setSearchLeases] = usePersistentState('properties:searchLeases', false)
  // Lease run-off window, in whole months from today. Kept as a filter rather than as
  // part of the lease lens so it narrows the table too — the lens only paints pins.
  const [leaseMin, setLeaseMin] = usePersistentState('properties:leaseMin', '')
  const [leaseMax, setLeaseMax] = usePersistentState('properties:leaseMax', '')
  // A single calendar month ('YYYY-MM'), set by clicking a bar on the dashboard graph.
  // Overrides min/max: "September" is a month on the calendar, not a rolling window from
  // today, and the two would disagree about which leases belong to it.
  const [leaseMonth, setLeaseMonth] = usePersistentState('properties:leaseMonth', '')
  // Sign date runs the other way: months BACK from today, so "signed in the last year"
  // is 0-12. This is the pricing filter — recent comps are the ones worth quoting.
  const [signMin, setSignMin] = usePersistentState('properties:signMin', '')
  const [signMax, setSignMax] = usePersistentState('properties:signMax', '')
  // Leased-unit SF, kept apart from the building-SF boxes: they measure different things,
  // so carrying a 200,000 typed against a shell over into "leased 200,000 SF" would be a
  // silent change of question rather than a convenience.
  const [leaseSfMin, setLeaseSfMin] = usePersistentState('properties:leaseSfMin', '')
  const [leaseSfMax, setLeaseSfMax] = usePersistentState('properties:leaseSfMax', '')
  // Decision maker at the tenant company: verified = someone Alex has actually spoken
  // to who makes the real-estate call. The tenant-side mirror of the owner filter.
  const [dmFilterRaw, setDmFilter] = usePersistentState('properties:leaseDm', 'all')
  const dmFilter = ['all', 'verified', 'unverified'].includes(dmFilterRaw) ? dmFilterRaw : 'all'
  const [page, setPage] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [pushOpen, setPushOpen] = useState(false)
  const [ownerMsgOpen, setOwnerMsgOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  // Flipped by the export dialog when lease columns are checked — the comps load then,
  // not when the map opens. Sticky for the visit, same rationale as wantsBook.
  const [exportWantsLeases, setExportWantsLeases] = useState(false)
  const [editing, setEditing] = useState<Property | null>(null)
  const [deleting, setDeleting] = useState<Property | null>(null)
  // Shape search: draw a polygon on the map. The completed shape lives here (not in the
  // map) because it also filters the table and drives the skip-trace export. The draft is
  // ephemeral on purpose — a half-drawn shape should not survive navigation.
  const [polygon, setPolygon] = usePersistentState<LatLng[] | null>('properties:shape', null)
  const [draft, setDraft] = useState<LatLng[] | null>(null)
  const drawMode = draft !== null
  // Where the map camera is pointed. Null until the map mounts and reports its bounds.
  const [viewport, setViewport] = useState<MapViewport | null>(null)
  // The map overlays: zoning districts (per type, per code) + lowlands, plus which
  // layers union their properties into the filtered set ("Include in search").
  const [overlaysRaw, setOverlays] = usePersistentState<OverlayState>('properties:overlays', OVERLAY_DEFAULT)
  const overlays = useMemo(() => safeOverlayState(overlaysRaw), [overlaysRaw])
  const overlayIncludes = useMemo(() => activeIncludes(overlays), [overlays])
  const overlayOnlys = useMemo(() => activeOnlys(overlays), [overlays])
  // Set the moment the user reaches for the search box or the filter panel — see the
  // fetch gate below. Sticky for the visit: once the book is on its way, keep it.
  const [wantsBook, setWantsBook] = useState(false)

  /**
   * The lenses are gone (Phase 2): every filter applies everywhere, with two
   * visibility-driven exceptions that stop a hidden control from silently narrowing
   * the map. The rail reveals the sale/lease + price sub-filters only while
   * "On market" is selected, and the activity dropdown only while "Verified contact"
   * is on — so on the map those apply only under the same conditions. The table's
   * Filters popover shows them unconditionally, so there they always apply.
   * County stays table-only (Alex): search and shape-draw already place a parcel.
   */
  const marketSubsApply = view === 'table' || status === 'on_market'
  const activitySubApplies = view === 'table' || ownerFilter === 'verified'
  const countyApplies = view === 'table'
  const leaseApplies = view === 'table' || searchLeases
  // The Zoned select left the map rail (Alex 2026-08-16: "we only need zoning layers")
  // — on the MAP the zoning question is asked through the layers + Include/Only. The
  // table's popover still carries the select, so it applies there only.
  const zonedApplies = view === 'table'

  // ?owner=<id> shows one owner's whole portfolio. It behaves as a filter rather than a
  // separate mode, so the map, the table, the columns and the export all keep working.
  const portfolioOwnerId = searchParams.get('owner')

  // Counts only what is actually biting: a dormant filter narrows nothing, so badging it
  // would send you hunting through the panel for a number that is not there.
  const activeFilterCount =
    (status !== 'all' ? 1 : 0) +
    (marketSubsApply && dealType !== 'all' ? 1 : 0) +
    (ptype !== 'all' ? 1 : 0) +
    (zonedApplies && zoningFilter !== 'all' ? 1 : 0) +
    (useFilter !== 'all' ? 1 : 0) +
    (dorActive ? 1 : 0) +
    (tagFilter.length > 0 ? 1 : 0) +
    (ownerOccMode !== 'all' ? 1 : 0) +
    (soldFilterOn ? 1 : 0) +
    (ownerFilter !== 'all' ? 1 : 0) +
    (activitySubApplies && activity !== 'all' ? 1 : 0) +
    (countyApplies && county !== 'all' ? 1 : 0) +
    (sfMin || sfMax ? 1 : 0) +
    (acMin || acMax ? 1 : 0) +
    (marketSubsApply && dealType === 'sale' && (priceMin || priceMax) ? 1 : 0) +
    (marketSubsApply && dealType === 'lease' && (psfMin || psfMax) ? 1 : 0) +
    // The three lease windows count separately: they are three questions, and a badge of
    // 1 for all of them would understate how narrow the list has become.
    (leaseApplies && (leaseMonth || leaseMin || leaseMax) ? 1 : 0) +
    (leaseApplies && (signMin || signMax) ? 1 : 0) +
    (leaseApplies && (leaseSfMin || leaseSfMax) ? 1 : 0) +
    (leaseApplies && dmFilter !== 'all' ? 1 : 0)

  /**
   * Is a question being asked about properties that might not be on screen?
   *
   * A search, a filter, a portfolio or a drawn shape can each match a parcel three
   * counties away, so answering one needs the whole book. The bare map does not: there
   * the camera IS the query, and the viewport fetch answers it in one round trip.
   */
  const hasText = searchTokens(search).length > 0
  const hasQuery =
    hasText ||
    activeFilterCount > 0 ||
    portfolioOwnerId != null ||
    (polygon != null && polygon.length >= 3)
  const viewportOnly = view === 'map' && !hasQuery
  /**
   * A typed search is answered by Postgres, not by the book — in BOTH views.
   *
   * The table used to search its own way, over a haystack the browser builds from the
   * book. That haystack holds only the address, so typing an owner's name found nothing
   * there while the map found the building; one search box behaving two ways is a bug
   * waiting to be reported. Both now ask the same question of the same function.
   *
   * Any other filter still rides along on top of the matches — narrowing a set of hundreds
   * is cheap. A portfolio is the exception: it asks about an owner, not about text, and it
   * wants every holding rather than the ones whose name happens to match.
   */
  const searchOnly = hasText && portfolioOwnerId == null

  /**
   * Which of the lease questions are being asked, in one place.
   *
   * Shared between the matcher below and the decision to fetch the comps at all: two
   * copies of "is a lease filter on?" that drifted apart would leave a filter narrowing
   * against comps that were never loaded, which reads as "nothing matches".
   */
  const leaseFilter = useMemo(() => {
    const monthPicked = /^\d{4}-\d{2}$/.test(leaseMonth)
    const expiryOn = monthPicked || leaseMin !== '' || leaseMax !== ''
    const signOn = signMin !== '' || signMax !== ''
    const sfOn = leaseSfMin !== '' || leaseSfMax !== ''
    // The DM filter activates lease matching by itself: "every lease where I can reach
    // the decision maker" is a real question with no date window attached.
    const dmOn = dmFilter !== 'all'
    return { monthPicked, expiryOn, signOn, sfOn, dmOn, any: expiryOn || signOn || sfOn || dmOn }
  }, [leaseMonth, leaseMin, leaseMax, signMin, signMax, leaseSfMin, leaseSfMax, dmFilter])
  // The book is what answers a filter, a shape or a portfolio — the questions Postgres
  // isn't being asked. `wantsBook` starts it the moment the filter panel opens rather than
  // when the filter is chosen, so the multi-second fetch happens while Alex is still
  // deciding instead of after.
  // An active "Include in search" needs the book too: the union scans every row's
  // zoning fields, and half its point is rows the camera has never seen.
  const needsBook = (!viewportOnly && !searchOnly) || wantsBook || overlayIncludes.length > 0

  const { data: properties, isLoading, isError, refetch } = useProperties(needsBook, bookMode)
  const { data: goodDealIds } = useGoodDealIds()
  const { data: executedIds } = useExecutedPropertyIds()
  const { data: askingMap } = useCurrentAsking()
  const { data: ownerCtxBook } = useOwnerContext(needsBook)
  // The comps answer lease questions only: the run-off lens, the lease filters, and the
  // table's tenant columns. On the bare market map they were ~1,300 rows of nothing, and
  // slow enough to crowd out the fetch that actually draws the pins.
  const { data: crossovers } = useIndustrialCrossovers()
  const { data: leases = [] } = useLeaseComps(view === 'table' || searchLeases || exportWantsLeases)
  /**
   * The viewport is fetched for two different jobs, and the second one outlives the first.
   *
   * Job one is the pins, when nothing has been asked. Job two is parcel recognition: at
   * street level the map draws the county's outlines, and it can only colour the ones we
   * hold — and make them open — for properties it has been told about. Under a search it
   * was told about the matches and nothing else, so 31 held properties around 1602 Combee
   * rendered as somebody else's land. So once outlines are in play, keep loading what is
   * on screen even while a search narrows the pins.
   */
  const parcelsVisible = (viewport?.zoom ?? 0) >= PARCEL_ZOOM
  const mapView = useMapProperties(viewport, view === 'map' && (viewportOnly || parcelsVisible), bookMode)
  // Trails the box so a query fires on pauses, not on every letter.
  const debouncedSearch = useDebouncedValue(search.trim(), 250)
  const mapSearch = useMapSearch(debouncedSearch, searchOnly, bookMode)
  /**
   * Between the keystroke and the query there is a quarter-second where nothing has been
   * asked yet and nothing has come back — and `isFetching` is false throughout it, because
   * the request does not exist. Reporting that honestly matters: without the first clause
   * the map answers "Nothing matches" before it has looked.
   */
  const searching =
    searchOnly && (debouncedSearch !== search.trim() || mapSearch.isFetching)

  /**
   * The set the page works from.
   *
   * On the map it is whatever was asked for and nothing more: the camera when nothing was
   * typed, the search results when something was. The book — ~17k rows and the owner
   * context to match — is now reserved for the questions neither of those can answer: a
   * filter on its own, a drawn shape, a portfolio, and the table.
   */
  const book = useMemo(
    // Memoised for its identity as much as its contents: `properties ?? []` would mint a
    // fresh empty array on every render while the book is still loading, and everything
    // downstream keys its useMemo off this.
    () =>
      viewportOnly
        ? mapView.data.properties
        : searchOnly
          ? mapSearch.data.properties
          : (properties ?? []),
    [viewportOnly, searchOnly, mapView.data.properties, mapSearch.data.properties, properties],
  )
  const ownerCtx = useMemo(() => {
    const base = viewportOnly
      ? mapView.data.ownerContext
      : searchOnly
        ? mapSearch.data.ownerContext
        : ownerCtxBook
    // Overlay-included rows come from the book, so their owner context must too —
    // otherwise the union's rows export with blank owner columns. Base wins on
    // collision: it is what the rest of the page is filtering on.
    if (overlayIncludes.length === 0 || !ownerCtxBook?.size) return base
    const merged = new Map(ownerCtxBook)
    for (const [id, ctx] of base ?? []) merged.set(id, ctx)
    return merged
  }, [viewportOnly, searchOnly, mapView.data.ownerContext, mapSearch.data.ownerContext, ownerCtxBook, overlayIncludes])

  // Deep link from a property's mini-map: /properties?view=map&q=<address>.
  // Every filter here is sticky, so a saved county/type/shape from an earlier session
  // would silently exclude the very property being linked to and land on an empty map.
  // "Show me this one property" outranks the saved filters, so clear them, then strip
  // the params so a later refresh doesn't wipe filters the user has since re-set.
  useEffect(() => {
    // The lens state is retired (Phase 2); a persisted value would otherwise sit in
    // localStorage forever.
    window.localStorage.removeItem('properties:colorBy')
    // the flat checked-code list predates the category-layer picker (2026-08-16)
    window.localStorage.removeItem('properties:dorCodes')
    const q = searchParams.get('q')
    const wantsMap = searchParams.get('view') === 'map'
    const wantsLease = searchParams.get('layer') === 'lease'
    const owner = searchParams.get('owner')
    if (!q && !wantsMap && !wantsLease) return
    // Both deep links are "show me exactly this set", so the sticky filters that would
    // silently exclude it get cleared first.
    const resetFilters = () => {
      setStatus('all')
      setDealType('all')
      setPtype('all')
      setZoningFilter('all')
      setUseFilter('all')
      setDorSel(DOR_SELECTION_DEFAULT)
      setCounty('all')
      setSfMin('')
      setSfMax('')
      setAcMin('')
      setAcMax('')
      setPriceMin('')
      setPriceMax('')
      setPsfMin('')
      setPsfMax('')
      setOwnerFilter('all')
      setActivity('all')
      setPolygon(null)
      // Lease windows are sticky too, and a stale one would cut the very set being
      // linked to. The lease branch below re-applies whatever the link asked for.
      setLeaseMin('')
      setLeaseMax('')
      setLeaseMonth('')
      setSignMin('')
      setSignMax('')
      setLeaseSfMin('')
      setLeaseSfMax('')
      setDmFilter('all')
      setPage(0)
    }
    if (q) {
      setSearch(q)
      resetFilters()
      // "Show me this one property" must also win over the condo exclusion — a
      // mini-map link into a garage unit would otherwise land on an empty map.
      setIncludeCondos(true)
    }
    if (wantsLease) {
      // Arriving from the dashboard graph: narrow to the lease window that was clicked
      // (the lease LENS is gone — the windows are plain filters now). Search is cleared
      // too — a leftover query would cut the set. The rail's Search-leases toggle
      // comes on so the window actually applies on the map.
      setSearch('')
      resetFilters()
      setSearchLeases(true)
      setLeaseMin(searchParams.get('expMin') ?? '')
      setLeaseMax(searchParams.get('expMax') ?? '')
      setLeaseMonth(searchParams.get('expMonth') ?? '')
    }
    if (wantsMap) setView('map')
    // Portfolio View (?owner=<company id>): the param IS the filter, so it must
    // survive this cleanup — stripping it here was why the owner card's button
    // landed on a plain map with nothing selected. A persisted drawn shape is
    // cleared too: it would suspend the fit-to-portfolio zoom (shapes suspend
    // refits by design), and "show me this owner's holdings" outranks a saved
    // shape exactly like the other deep links outrank saved filters.
    if (owner) setPolygon(null)
    setSearchParams(owner ? { owner } : {}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Guard against a tampered/legacy localStorage value that isn't an array.
  const safeColumns = Array.isArray(columns) ? columns : DEFAULT_COLUMNS
  // Render in registry order, filtered to the chosen set (so 'size'->'acres' is just a swap).
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
  // Book-only by design: the county dropdown is a table filter, and the table always has
  // the book behind it.
  const counties = useMemo(() => {
    const set = new Set<string>()
    for (const p of properties ?? []) if (p.county) set.add(p.county)
    return [...set].sort()
  }, [properties])

  // One canonical searchable string per property, rebuilt only when the book changes — the
  // normalizer is too costly to re-run over ~17k rows on every keystroke.
  const haystacks = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of book)
      map.set(
        p.id,
        buildHaystack([
          p.address,
          // the marketing address the listing site gave us, when it differs from the county's —
          // brokers know this building as "4428-4450 Eagle Falls Pl" even though the county
          // (and every caller) calls it 4456
          p.source_address,
          p.city,
          p.state,
          p.zip,
          p.specs,
          p.county,
          // both county parcel ids, so a folio or PIN pasted from GHL finds the property
          p.parcel_number,
          p.folio,
          p.property_type ? propertyKindLabels[p.property_type] : null,
        ]),
      )
    return map
  }, [book])

  /**
   * The one lease that best represents each parcel: the soonest still to run, or — for a
   * building whose leases have all ended — the one that ended most recently, since that
   * is the comp you would price against. Drives pin colour and the hover card, and is
   * deliberately independent of the window filter: a building shown because it expires
   * in 9 months should still be painted as a 9-month building.
   */
  const leaseSoonest = useMemo(() => {
    const m = new Map<string, LeaseComp>()
    for (const l of leases) {
      if (!l.property_id) continue
      const months = l.months_to_expiry
      if (months == null) continue
      const cur = m.get(l.property_id)
      if (cur == null) {
        m.set(l.property_id, l)
        continue
      }
      const curM = cur.months_to_expiry as number
      // A running lease always beats an expired one; among running leases the soonest
      // wins, among expired ones the latest to have ended.
      const better = months >= 0 ? curM < 0 || months < curM : curM < 0 && months > curM
      if (better) m.set(l.property_id, l)
    }
    return m
  }, [leases])

  /**
   * Parcels with at least one lease satisfying every active lease criterion, or null when
   * none is set (meaning "don't filter on leases at all"). Expiry, sign date and leased
   * size are ANDed, and all must hold on the SAME lease — a building with an old lease
   * that expires soon and a new 5,000 SF one signed last month is not a match for
   * "expires within 3 months AND 5,000 SF AND signed this year".
   */
  const leaseMatch = useMemo(() => {
    const num = (v: string) => {
      const n = Number(v)
      return v !== '' && Number.isFinite(n) ? n : null
    }
    const { monthPicked, expiryOn, signOn, sfOn, dmOn, any } = leaseFilter
    // Dormant on the map unless "Search leases" is on — same visibility-mirrors-
    // application rule as the market sub-filters.
    if (!any || !leaseApplies) return null
    const sfLo = num(leaseSfMin)
    const sfHi = num(leaseSfMax)
    // An empty expiry minimum means "from today", not "since the beginning of time".
    // Without this floor, "expires within 3 months" also drags in the 700-odd leases
    // that ran out years ago. Reaching back is a real use — it just has to be asked
    // for, with a negative minimum or the sign-date filter.
    const lo = num(leaseMin) ?? 0
    const hi = num(leaseMax)
    const sLo = num(signMin) ?? 0
    const sHi = num(signMax)
    const ids = new Set<string>()
    // The lease that put the parcel on the list — so the Tenant column names the tenant
    // you are here about, not whichever of the building's leases sorts first.
    const top = new Map<string, LeaseComp>()
    for (const l of leases) {
      if (!l.property_id) continue
      if (expiryOn) {
        if (!l.expiration_date) continue
        const hit = monthPicked
          ? l.expiration_date.slice(0, 7) === leaseMonth
          : withinMonths(l, lo, hi)
        if (!hit) continue
      }
      if (signOn && !signedWithinMonths(l, sLo, sHi)) continue
      if (sfOn) {
        // A lease with no recorded size cannot satisfy a size question.
        if (l.sf == null) continue
        if (sfLo != null && l.sf < sfLo) continue
        if (sfHi != null && l.sf > sfHi) continue
      }
      // Binary on verified, same as the owner lens: a suspected DM is a lead to work,
      // not a person you can call today.
      if (dmOn) {
        if (dmFilter === 'verified' && !l.dm_verified) continue
        if (dmFilter === 'unverified' && l.dm_verified) continue
      }
      ids.add(l.property_id)
      const cur = top.get(l.property_id)
      // Most recently signed wins when pricing; soonest to expire when hunting vacancy.
      const better = signOn
        ? !cur || (cur.signed_date ?? '') < (l.signed_date ?? '')
        : !cur || (cur.expiration_date ?? '') > (l.expiration_date ?? '')
      if (better) top.set(l.property_id, l)
    }
    return { ids, top }
  }, [leases, leaseFilter, leaseApplies, leaseMin, leaseMax, leaseMonth, signMin, signMax, leaseSfMin, leaseSfMax, dmFilter])
  const leaseMatchIds = leaseMatch?.ids ?? null

  // Tenant + expiry ride along whenever a lease window is filtering, so the list answers
  // "who is leaving" without a trip to the column menu. Appended rather than saved: the
  // moment the window clears, the chosen columns are exactly as they were left. (Declared
  // here because it reads leaseMatchIds above.)
  const visibleColumns = COLUMN_DEFS.filter(
    (c) =>
      (safeColumns.includes(c.id) && !LEASE_COLUMNS.includes(c.id)) ||
      (leaseMatchIds != null && LEASE_COLUMNS.includes(c.id)),
  )

  const portfolioAll = useMemo(
    () => (portfolioOwnerId ? book.filter((p) => p.owner_company_id === portfolioOwnerId) : []),
    [book, portfolioOwnerId],
  )
  // The COMPANY's name, not the first row's county deed string — a portfolio's
  // parcels can carry different deed names (assemblage quirks), and the banner
  // names the owner the button was pressed on.
  const portfolioOwnerName =
    (portfolioAll[0] && ownerCtx?.get(portfolioAll[0].id)?.owner_name) ??
    portfolioAll[0]?.owner_name ??
    null

  const { baseFiltered, includeCandidates, condoHidden } = useMemo(() => {
    // Empty when Postgres did the matching. Re-running the browser's own test over those
    // rows would quietly drop the hits it found by parcel number or folio, which do not
    // appear in the haystack at all — the same trap `contact-select` avoids with
    // `shouldFilter={false}`.
    const tokens = searchOnly ? [] : searchTokens(search)
    const n = (v: string) => {
      const x = parseFloat(v)
      return Number.isFinite(x) ? x : null
    }
    const sfLo = n(sfMin), sfHi = n(sfMax)
    const acLo = n(acMin), acHi = n(acMax)
    const prLo = n(priceMin), prHi = n(priceMax)
    const psfLo = n(psfMin), psfHi = n(psfMax)
    // A portfolio is a question about ONE owner, so it answers with all of their
    // holdings. Letting the sticky filters through means an on-market status quietly
    // hides the two off-market parcels next door — which is the assemblage you were
    // trying to see.
    if (portfolioOwnerId) {
      // Condo units stay too: an owner's 30 garage units ARE their portfolio.
      return {
        baseFiltered: book.filter((p) => p.owner_company_id === portfolioOwnerId),
        includeCandidates: [] as typeof book,
        condoHidden: 0,
      }
    }
    // One pass, two buckets: rows passing EVERY filter (base), and rows failing ONLY the
    // use/zoning axes (candidates for the overlay "Include in search" union). Splitting
    // here is what lets the union respect the drawn shape, the search, sizes and market
    // status — Alex 2026-08-16: "it should only include the ones in the drawn area".
    const base: typeof book = []
    const candidates: typeof book = []
    let condosDropped = 0
    for (const p of book) {
      // Every token must appear somewhere in the property's combined text, so a full
      // "3206 Sydney Rd Plant City, FL 33566" matches even though the street, city, state and
      // zip live in different columns.
      if (tokens.length && !matchesTokens(haystacks.get(p.id) ?? '', tokens)) continue
      // 'executed' is a lens on OUR deals, not a listing_status value — hence its own branch.
      if (status === 'executed') {
        if (!executedIds?.has(p.id)) continue
      } else if (status !== 'all' && (p.listing_status ?? 'on_market') !== status) continue
      /**
       * For lease / for sale, priced by the current asking comp. The price question
       * switches with the choice — lease asks $/SF, sale asks total — and a listing
       * priced only the OTHER way is the other kind of listing, so it fails. A listing
       * with no price at all rides along while "include listings without a price" is
       * checked (default ON — the map must not silently hide unpriced listings).
       */
      if (marketSubsApply && dealType !== 'all') {
        const ask = askingMap?.get(p.id)
        const rate = ask?.rate ?? null
        const total = ask?.price ?? null
        const value = dealType === 'lease' ? rate : total
        if (value != null) {
          const lo = dealType === 'lease' ? psfLo : prLo
          const hi = dealType === 'lease' ? psfHi : prHi
          if (lo != null && value < lo) continue
          if (hi != null && value > hi) continue
        } else {
          const fullyUnpriced = rate == null && total == null
          if (!(includeUnpriced && fullyUnpriced)) continue
        }
      }
      // Binary on purpose (Alex): either we can reach the owner today, or the parcel goes
      // on the next skip-trace list — county-known-but-uncontacted is still "not verified".
      // The phone/email checkmarks pick WHICH channel counts; both checked = either,
      // which is exactly the old owner_reachable.
      if (ownerFilter === 'verified') {
        const ctx = ownerCtx?.get(p.id)
        const phoneOk = channels.phone && !!ctx?.owner_contact_verified
        const emailOk = channels.email && !!ctx?.owner_email_verified
        if (!phoneOk && !emailOk) continue
      } else if (ownerFilter === 'unverified') {
        if (ownerCtx?.get(p.id)?.owner_reachable) continue
      }
      // 30 days of ANY logged contact, matching the owner blast exactly. Never contacted
      // counts as quiet — it is the far end of the same axis, not a missing value.
      if (activitySubApplies && activity !== 'all') {
        const last = ownerCtx?.get(p.id)?.last_contacted_at
        const recent = last != null && new Date(last).getTime() >= activityCutoff
        if (activity === 'recent' && !recent) continue
        if (activity === 'quiet' && recent) continue
      }
      if (leaseMatchIds && !leaseMatchIds.has(p.id)) continue
      // Tags. `tagIds` is null until the lookup lands, and an unresolved set deliberately
      // matches NOTHING rather than everything — a filter that is on but not yet answered
      // must not read as "no tags here", which is the mistake that makes a truncated set
      // look like the whole truth. The rail says "Finding tagged properties…" meanwhile.
      if (tagFilter.length > 0 && !tagIds?.has(p.id)) continue
      // Owner-operator tri-state. Same null-set discipline as tags: while the lookup is
      // unanswered, 'only' matches nothing (never "nobody is tagged") and 'hide' hides
      // nothing (never "hide everyone").
      if (ownerOccMode === 'only' && !ownerOccIds?.has(p.id)) continue
      if (ownerOccMode === 'hide' && ownerOccIds?.has(p.id)) continue
      // Recently sold — the cutoff compares against the latest transfer comp. Until the map
      // loads the filter simply hasn't engaged yet (an exclusion can't hold rows it hasn't
      // seen); no-sale-date rows ride on the companion toggle.
      if (soldFilterOn && lastSales) {
        const last = lastSales.get(p.id)
        if (last) {
          const cutoff = Date.now() - soldYearsNum * 365.25 * 24 * 3600 * 1000
          if (new Date(last).getTime() >= cutoff) continue
        } else if (!includeNoSale) continue
      }
      if (countyApplies && county !== 'all' && p.county !== county) continue
      // A size search must also see the units. A landlord who will carve 30,000 SF
      // out of a 93,666 SF building answers a 30k requirement — but the building
      // itself is far too big, so filtering on gross_sf alone excludes the very
      // property the search is for.
      if (sfLo != null || sfHi != null) {
        const sizes = [p.gross_sf, ...(unitSizes?.get(p.id) ?? [])].filter(
          (v): v is number => v != null,
        )
        const fits = sizes.some(
          (v) => (sfLo == null || v >= sfLo) && (sfHi == null || v <= sfHi),
        )
        if (!fits) continue
      }
      if (acLo != null && (p.land_acres == null || p.land_acres < acLo)) continue
      if (acHi != null && (p.land_acres == null || p.land_acres > acHi)) continue
      // Shape before the use axes: expensive, but it must bind on BOTH buckets — the
      // overlay union is only allowed to forgive what-the-property-is, never where-it-is.
      if (polygon && polygon.length >= 3 && !pointInPolygon(polygon, p.lat, p.lng)) continue

      // ---- The use axes: what the property IS (type / zoning / DOR). A row failing
      // ONLY these is an include-candidate — the overlay union may forgive them.
      let passesUse = true
      if (ptype !== 'all' && p.property_type !== ptype) passesUse = false
      // The ZONING axis. 'industrial' spans primary + crossover codes (allows_industrial);
      // 'non_industrial' means zoned, and not for industrial — the grandfathered test.
      // Unzoned rows fail every specific pick: no answer is not a match.
      if (passesUse && zonedApplies && zoningFilter !== 'all') {
        if (zoningFilter === 'industrial_any') {
          // the whole industrial universe: zoned for it OR already used as it —
          // the grandfathered cohort belongs to "everything industrial" (Alex)
          if (!isZonedIndustrial(p, crossovers) && !isIndustrialUse(p.dor_use_code)) passesUse = false
        } else if (zoningFilter === 'industrial') {
          if (!isZonedIndustrial(p, crossovers)) passesUse = false
        } else if (zoningFilter === 'non_industrial') {
          if (p.zoning_type == null || isZonedIndustrial(p, crossovers)) passesUse = false
        } else if (p.zoning_type !== zoningFilter) passesUse = false
      }
      // The USE axis: the county's DOR code, bucketed.
      if (passesUse && useFilter !== 'all' && dorBucket(p.dor_use_code) !== useFilter) passesUse = false
      // The picker's layers — categories via the dor_codes filing, customs verbatim.
      if (passesUse && dorActive && !matchesDorSelection(p.county, p.dor_use_code, dorSel, dorCategoryByCode, dorLandCodes)) passesUse = false

      // Condo gate LAST, after every other filter has had its say: the hidden count is
      // then exactly the rows THIS view lost to the lens — not the book-wide constant
      // 2,077 that an early drop reports the moment any filter engages the whole book.
      // Never a candidate either: the overlay union must not resurrect condo units.
      if (!includeCondos && p.is_condo_unit) {
        if (passesUse) condosDropped++
        continue
      }
      if (passesUse) base.push(p)
      else candidates.push(p)
    }
    return { baseFiltered: base, includeCandidates: candidates, condoHidden: condosDropped }
  }, [book, portfolioOwnerId, searchOnly, haystacks, askingMap, ownerCtx, ownerFilter, channels, activity, activityCutoff, executedIds, leaseMatchIds, tagFilter, tagIds, ownerOccMode, ownerOccIds, soldFilterOn, soldYearsNum, includeNoSale, lastSales, marketSubsApply, activitySubApplies, countyApplies, zonedApplies, includeUnpriced, includeCondos, search, unitSizes, status, dealType, ptype, zoningFilter, useFilter, dorActive, dorSel, dorCategoryByCode, dorLandCodes, crossovers, county, sfMin, sfMax, acMin, acMax, priceMin, priceMax, psfMin, psfMax, polygon])

  /**
   * "Include in search": union each toggled overlay layer's properties into the set,
   * so the count line, exports and skip-trace carry them (Alex, 2026-08-15). Membership
   * is the row's own (jurisdiction, code) — the overlay shapes and `properties.zoning_*`
   * come from the same pipeline — with the industrial layer meaning allows_industrial,
   * exactly like the zoning filter. Never point-in-polygon against the OVERLAY.
   *
   * The union forgives ONLY the use axes (type / zoning / DOR picks) — candidates have
   * already passed the drawn shape, search, sizes, market and owner filters (Alex,
   * 2026-08-16: "it should only include the ones in the drawn area"). His flow: draw an
   * area, filter to DOR industrial, and the office-coded building on industrial-zoned
   * land inside the shape joins the set — the one across town does not.
   */
  const filtered = useMemo(() => {
    if (portfolioOwnerId) return baseFiltered
    let out = baseFiltered
    if (overlayIncludes.length > 0) {
      const extra = includeCandidates.filter((p) =>
        overlayIncludes.some((t) => rowInOverlay(p, t, overlays[t], crossovers)),
      )
      if (extra.length) out = [...out, ...extra]
    }
    // "Only these": restrict to the only-layers' members — check just CG and the map
    // shows nothing but CG-zoned parcels (Alex 2026-08-16). Applied AFTER the include
    // union, and on top of every other filter (shape, sizes, market still bind).
    if (overlayOnlys.length > 0) {
      out = out.filter((p) => overlayOnlys.some((t) => rowInOverlay(p, t, overlays[t], crossovers)))
    }
    return out
  }, [baseFiltered, includeCandidates, overlayIncludes, overlayOnlys, overlays, portfolioOwnerId, crossovers])

  /**
   * Everything the map should RECOGNISE, as opposed to everything it should pin.
   *
   * The answer to the question keeps the pins; the properties around it keep their
   * outlines. Without this union a search turns every neighbour Alex owns into an
   * anonymous county polygon that opens a popup instead of the property — 31 of them
   * around 1602 Combee Rd.
   */
  const parcelSource = useMemo(() => {
    if (viewportOnly) return filtered
    const seen = new Set(filtered.map((p) => p.id))
    return [...filtered, ...mapView.data.properties.filter((p) => !seen.has(p.id))]
  }, [viewportOnly, filtered, mapView.data.properties])

  /**
   * Owner context for everything on screen, not just the matches — otherwise a neighbour's
   * outline is drawn in the colour of an owner we know nothing about. The narrower set
   * wins on collision, since it is the one the rest of the page is filtering on.
   */
  const mapOwnerCtx = useMemo(() => {
    if (viewportOnly || mapView.data.ownerContext.size === 0) return ownerCtx
    const merged = new Map(mapView.data.ownerContext)
    for (const [id, ctx] of ownerCtx ?? []) merged.set(id, ctx)
    return merged
  }, [viewportOnly, mapView.data.ownerContext, ownerCtx])

  // Reset to the first page whenever a filter/search edit changes the result set.
  useEffect(() => {
    setPage(0)
  }, [search, status, dealType, ownerFilter, channels, activity, ptype, zoningFilter, useFilter, dorActive, dorSel, dorCategoryByCode, dorLandCodes, county, sfMin, sfMax, acMin, acMax, priceMin, priceMax, psfMin, psfMax, includeUnpriced, includeCondos, ownerOccMode, soldYears, includeNoSale, polygon, leaseMatchIds])

  /**
   * Skip-trace hand-off: the current filtered set as CSV. Parcel ID leads because it is the
   * join key that has to survive Terrakotta and GHL and come back to the right owner.
   */
  // Push splits the current view in two: owners we can actually dial, and everything else.
  // A verified owner with no phone is not pushable — GHL keys contacts on the number — so
  // those fall to the skip-trace CSV instead of silently vanishing from the count.
  //
  // Deduped by phone here rather than only in n8n: one owner routinely holds a dozen of the
  // properties on screen, and the dialog must promise the number that actually gets pushed.
  const { pushable, skippedIds } = useMemo(() => {
    const byPhone = new Map<string, PushContact>()
    const skipped: string[] = []
    for (const p of filtered) {
      const o = ownerCtx?.get(p.id)
      const digits = String(o?.best_contact_phone ?? '').replace(/\D/g, '')
      const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
      if (!o?.owner_contact_verified || ten.length !== 10) {
        skipped.push(p.id)
        continue
      }
      if (byPhone.has(ten)) continue
      const name = (o.best_contact_name ?? '').trim()
      const sp = name.indexOf(' ')
      byPhone.set(ten, {
        phone: ten,
        first: sp > 0 ? name.slice(0, sp) : name || null,
        last: sp > 0 ? name.slice(sp + 1) : null,
        email: o.best_contact_email ?? null,
        ownerName: o.owner_name ?? p.owner_name ?? null,
        address: p.address ?? null,
        city: p.city ?? null,
        parcel: p.parcel_number ?? null,
        propertyId: p.id,
      })
    }
    return { pushable: [...byPhone.values()], skippedIds: skipped }
  }, [filtered, ownerCtx])

  // Every verified owner in view, INCLUDING the ones with no number. A list that
  // silently drops them answers "who is getting this" but not "who is missing", and the
  // second question is the one that sends you skip-tracing.
  const ownerRecipients: OwnerRecipient[] = useMemo(() => {
    const seen = new Set<string>()
    const out: OwnerRecipient[] = []
    for (const p of filtered) {
      const o = ownerCtx?.get(p.id)
      if (!o?.owner_contact_verified && !o?.owner_email_verified) continue
      const digits = String(o?.best_contact_phone ?? '').replace(/\D/g, '')
      const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
      const phone = ten.length === 10 ? ten : null
      const key = phone ?? `prop:${p.id}`
      if (seen.has(key)) continue
      seen.add(key)
      const name = (o.best_contact_name ?? '').trim()
      const sp = name.indexOf(' ')
      const street = (p.address ?? '').replace(/^\d+\s+/, '').trim() || null
      out.push({
        recipientId: p.id,
        ownerId: p.owner_company_id ?? null,
        phone,
        first: sp > 0 ? name.slice(0, sp) : name || null,
        last: sp > 0 ? name.slice(sp + 1) : null,
        company: o.owner_name ?? p.owner_name ?? null,
        address: p.address ?? null,
        lastContactedAt: o.last_contacted_at ?? null,
        ctx: {
          'property.address': p.address,
          'property.city': p.city,
          'property.street': street,
          'property.city_suffix': p.city ? ` in ${p.city}` : '',
        },
        cf: [
          p.parcel_number ? { id: 'VxEwTurixSyHFqlqV2O8', field_value: p.parcel_number } : null,
          p.address ? { id: 'iUJbtzcHw0ShIXkzoBpp', field_value: p.address } : null,
          p.city ? { id: 'FLoZeiY2w6wJt4tw3Fe0', field_value: p.city } : null,
          o.owner_name ? { id: 'a4vHj26a4Kn657PnYCnI', field_value: o.owner_name } : null,
        ].filter(Boolean) as { id: string; field_value: string }[],
      })
    }
    return out
  }, [filtered, ownerCtx])

  /** The rows the push cannot take — same shape as the main export, for skip-tracing. */
  const exportSkipped = () => {
    const ids = new Set(skippedIds)
    const rows = filtered.filter((p) => ids.has(p.id))
    if (rows.length === 0) return
    const headers = ['Parcel ID', 'Address', 'City', 'State', 'Zip', 'County', 'Owner Name', 'Owner Mailing Address', 'Building SF', 'Acres', 'CRM Property ID']
    downloadCsv(
      `skiptrace-needed-${todayStamp()}-${rows.length}.csv`,
      toCsv(headers, rows.map((p) => {
        const o = ownerCtx?.get(p.id)
        return [p.parcel_number, p.address, p.city, p.state, p.zip, p.county,
                o?.owner_name ?? p.owner_name, p.owner_mailing_address,
                p.gross_sf, p.land_acres, p.id]
      })),
    )
  }

  /** The representative lease per property: the window's match, else soonest-running. */
  const getExportLease = (propertyId: string) =>
    leaseMatch?.top.get(propertyId) ?? leaseSoonest.get(propertyId)

  // Paginate the table display (data is fully loaded; this just bounds the DOM).
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  const clearFilters = () => {
    setStatus('all')
    setDealType('all')
    setPsfMin('')
    setPsfMax('')
    setIncludeUnpriced(true)
    setChannels({ phone: true, email: true })
    setPtype('all')
    setZoningFilter('all')
    setUseFilter('all')
    setDorSel(DOR_SELECTION_DEFAULT)
    setTagFilter([])
    setOwnerFilter('all')
    setActivity('all')
    setCounty('all')
    setSfMin('')
    setSfMax('')
    setAcMin('')
    setAcMax('')
    setPriceMin('')
    setPriceMax('')
    setLeaseMin('')
    setLeaseMax('')
    setLeaseMonth('')
    setSignMin('')
    setSignMax('')
    setLeaseSfMin('')
    setLeaseSfMax('')
    setDmFilter('all')
    setIncludeCondos(false)
  }

  // Said out loud wherever a count is: rows the condo exclusion removed from the
  // current set. Without it, a hidden unit reads as "we don't have that property".
  const condoSuffix =
    condoHidden > 0 ? ` · ${condoHidden.toLocaleString()} condo units hidden` : ''

  /** The top bar's map count — same honesty rules the old toolbar line followed. */
  const mapStatusText =
    overlayIncludes.length > 0
      ? isLoading
        ? 'Loading the book to include the overlay…'
        : `${filtered.length.toLocaleString()} matching incl. overlay properties${condoSuffix}`
      : polygon
        ? `${filtered.length.toLocaleString()} in shape${condoSuffix}`
        : searchOnly
          ? searching
            ? 'Searching…'
            : // A failed search has no results, and "0 matching" reads as "we don't
              // have it" — the exact lie the map's own empty hint already refuses to
              // tell. Broad searches DO occasionally 500 on the owner-context join.
              mapSearch.isError
              ? 'Search failed — try again'
              : mapSearch.searchCapped
              ? filtered.length < MAP_SEARCH_LIMIT
                ? `${filtered.length.toLocaleString()} of the first ${MAP_SEARCH_LIMIT.toLocaleString()} matches — narrow the search`
                : `First ${MAP_SEARCH_LIMIT.toLocaleString()} matches — narrow the search`
              : `${filtered.length.toLocaleString()} matching${condoSuffix}`
          : hasQuery
            ? isLoading
              ? 'Loading the book to filter it…'
              : `${filtered.length.toLocaleString()} matching${condoSuffix}`
            : mapView.isFetching
              ? 'Loading this area…'
              : // The box count comes from the server, which counts condo units too —
                // subtract what the lens dropped so the number matches the pins.
                `${Math.max(0, mapView.data.totalInView - condoHidden).toLocaleString()} in this area${condoSuffix}`

  // "Clear all": every rail filter back to its default in one tap (Alex 2026-08-16).
  // The search box survives — clearing FILTERS shouldn't eat a typed address.
  const clearAllFilters = () => {
    setPolygon(null)
    setDraft(null)
    setSfMin(''); setSfMax(''); setAcMin(''); setAcMax('')
    setStatus('all'); setDealType('all')
    setPsfMin(''); setPsfMax(''); setPriceMin(''); setPriceMax('')
    setIncludeUnpriced(true)
    setOwnerFilter('all'); setChannels({ phone: true, email: true }); setActivity('all')
    setSearchLeases(false)
    setLeaseMin(''); setLeaseMax(''); setLeaseMonth('')
    setSignMin(''); setSignMax(''); setLeaseSfMin(''); setLeaseSfMax(''); setDmFilter('all')
    setDorSel(DOR_SELECTION_DEFAULT)
    setTagFilter([])
    setOverlays(OVERLAY_DEFAULT)
    // the table popover's axes too — they'd silently come back with the table view
    setPtype('all'); setZoningFilter('all'); setUseFilter('all'); setCounty('all')
    // back to the canvassing default: condo units out
    setIncludeCondos(false)
    setOwnerOccMode('all')
    setSoldYears(''); setIncludeNoSale(true)
  }

  // One rail, two surfaces: the desktop aside and the phone bottom-sheet render the
  // same element, so they can never disagree about what a filter means.
  const railContent = (
    <MapFilterRail
      book={bookMode}
      polygon={polygon}
      draft={draft}
      onStartDraw={() => { setPolygon(null); setDraft([]) }}
      onFinishDraw={() => { setPolygon(draft); setDraft(null) }}
      onUndoVertex={() => setDraft((d) => (d && d.length > 0 ? d.slice(0, -1) : d))}
      onCancelDraw={() => setDraft(null)}
      onClearShape={() => setPolygon(null)}
      onClearAll={clearAllFilters}
      tagFilter={tagFilter}
      onTagFilter={setTagFilter}
      tagsLoading={tagsLoading}
      sfMin={sfMin} sfMax={sfMax} onSfMin={setSfMin} onSfMax={setSfMax}
      acMin={acMin} acMax={acMax} onAcMin={setAcMin} onAcMax={setAcMax}
      status={status} onStatus={setStatus}
      dealType={dealType} onDealType={setDealType}
      psfMin={psfMin} psfMax={psfMax} onPsfMin={setPsfMin} onPsfMax={setPsfMax}
      priceMin={priceMin} priceMax={priceMax} onPriceMin={setPriceMin} onPriceMax={setPriceMax}
      includeUnpriced={includeUnpriced} onIncludeUnpriced={setIncludeUnpriced}
      ownerFilter={ownerFilter}
      onOwnerFilter={setOwnerFilter}
      channels={channels} onChannels={setChannels}
      activity={activity} onActivity={setActivity}
      pushCount={pushable.length}
      onPush={() => setPushOpen(true)}
      onMessage={() => setOwnerMsgOpen(true)}
      searchLeases={searchLeases} onSearchLeases={setSearchLeases}
      leaseMin={leaseMin} leaseMax={leaseMax} onLeaseMin={setLeaseMin} onLeaseMax={setLeaseMax}
      leaseMonth={leaseMonth} onLeaseMonth={setLeaseMonth}
      signMin={signMin} signMax={signMax} onSignMin={setSignMin} onSignMax={setSignMax}
      leaseSfMin={leaseSfMin} leaseSfMax={leaseSfMax} onLeaseSfMin={setLeaseSfMin} onLeaseSfMax={setLeaseSfMax}
      dmFilter={dmFilter} onDmFilter={setDmFilter}
      dorSel={dorSel} onDorSel={setDorSel}
      includeCondos={includeCondos} onIncludeCondos={setIncludeCondos}
      ownerOccMode={ownerOccMode} onOwnerOccMode={setOwnerOccMode}
      soldYears={soldYears} onSoldYears={setSoldYears}
      includeNoSale={includeNoSale} onIncludeNoSale={setIncludeNoSale}
      condoHidden={condoHidden}
      overlays={overlays} onOverlays={setOverlays}
      onOverlayIncludeOn={() => setWantsBook(true)}
    />
  )

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
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">War Room</h1>
          {/* The book toggle: same anatomy as the view toggle so it reads as a mode,
              not a filter. Land = developer-land book; crossovers show in both. */}
          <div className="inline-flex shrink-0 overflow-hidden rounded-md border">
            <Button
              variant={bookMode === 'industrial' ? 'secondary' : 'ghost'}
              size="sm"
              className="rounded-none"
              onClick={() => setBookMode('industrial')}
              title="Industrial book"
            >
              Industrial
            </Button>
            <Button
              variant={bookMode === 'land' ? 'secondary' : 'ghost'}
              size="sm"
              className="rounded-none border-l"
              onClick={() => setBookMode('land')}
              title="Land book — developer land (vacant, ag, and ≤5% building-to-land)"
            >
              Land
            </Button>
          </div>
        </div>
        {/* The search stretches the whole top (Alex) — everything else keeps its size. */}
        <div className="flex w-full items-center gap-2 sm:flex-1">
          <div className="relative min-w-40 flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            {/* No prefetch on focus any more: typing here is answered by Postgres, so the
                search box no longer has a book to warm. */}
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search properties…"
              className="pl-9 pr-8"
            />
            {/* The search is sticky now, so it needs a one-tap way out — without this,
                yesterday's query silently narrows today's map. */}
            {search !== '' && (
              <button
                type="button"
                title="Clear search"
                onClick={() => setSearch('')}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
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
          {/* The lenses are gone: the top bar keeps only the count, Export and (on the
              phone) the drawer that holds the rail. */}
          {view === 'map' && (
            <span className="hidden text-sm text-muted-foreground lg:inline">{mapStatusText}</span>
          )}
          {/* ONE Export button everywhere — it opens the dialog, never an instant download. */}
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => setExportOpen(true)}
            disabled={filtered.length === 0}
          >
            <Download className="size-4" />
            <span className="hidden sm:inline">Export CSV</span>
            {filtered.length > 0 ? ` (${filtered.length.toLocaleString()})` : ''}
          </Button>
          {view === 'map' && (
            <Sheet>
              <SheetTrigger asChild>
                <Button size="sm" variant="outline" className="shrink-0 md:hidden">
                  <SlidersHorizontal className="size-4" />
                  Map filters
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Map filters</SheetTitle>
                </SheetHeader>
                <div className="px-4 pb-6">{railContent}</div>
              </SheetContent>
            </Sheet>
          )}
          {/* The popover is the TABLE's filter surface; the map's filters all live in
              the rail now (Alex, 2026-08-16). Opening it is the same signal as clicking
              the search box: a filter is about to narrow the book, so fetch it now. */}
          {view === 'table' && (
          <Popover onOpenChange={(open) => open && setWantsBook(true)}>
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
              {/* On the map these live in the rail; the popover only carries them for
                  the table, so one control never shows in two places at once. */}
              {view === 'table' && (
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
              )}
              {/* Tags — the same picks the map rail offers, so the filter is visible on
                  whichever surface is applying it (a control that narrows the list from
                  offscreen is the one bug this popover exists to avoid). */}
              {view === 'table' && (
                <div className="space-y-1.5">
                  <Label>Tags</Label>
                  <div className="space-y-1">
                    {PROPERTY_TAG_OPTIONS.map((o) => (
                      <label key={o.key} className="flex cursor-pointer items-center gap-2 text-xs">
                        <Checkbox
                          checked={tagFilter.includes(o.key)}
                          onCheckedChange={(v) =>
                            setTagFilter(
                              v === true
                                ? [...tagFilter, o.key]
                                : tagFilter.filter((t) => t !== o.key),
                            )
                          }
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                  {tagFilter.length > 0 && tagsLoading && (
                    <p className="text-xs text-muted-foreground">Finding tagged properties…</p>
                  )}
                </div>
              )}
              {view === 'table' && (
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
                  {/* The price question switches with the choice — same model as the rail. */}
                  {dealType === 'lease' && (
                    <div className="flex items-center gap-2 pt-1">
                      <CurrencyInput placeholder="Min $/SF" value={psfMin} onValueChange={setPsfMin} />
                      <span className="text-muted-foreground">–</span>
                      <CurrencyInput placeholder="Max $/SF" value={psfMax} onValueChange={setPsfMax} />
                    </div>
                  )}
                  {dealType === 'sale' && (
                    <div className="flex items-center gap-2 pt-1">
                      <CurrencyInput placeholder="Min price" value={priceMin} onValueChange={setPriceMin} />
                      <span className="text-muted-foreground">–</span>
                      <CurrencyInput placeholder="Max price" value={priceMax} onValueChange={setPriceMax} />
                    </div>
                  )}
                  {dealType !== 'all' && (
                    <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs">
                      <Checkbox
                        checked={includeUnpriced}
                        onCheckedChange={(v) => setIncludeUnpriced(v === true)}
                      />
                      Include listings without a price
                    </label>
                  )}
                </div>
              )}
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
              {/* The two-axis refinement: what it IS (county use) × what it MAY BECOME
                  (zoning). Side by side because they are meant to be crossed. */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>County use</Label>
                  <Select value={useFilter} onValueChange={setUseFilter}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any use</SelectItem>
                      {DOR_FILTER_ORDER.map((b) => (
                        <SelectItem key={b} value={b}>
                          {dorBucketLabels[b]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Zoned</Label>
                  <Select value={zoningFilter} onValueChange={setZoningFilter}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any zoning</SelectItem>
                      <SelectItem value="industrial_any">Industrial — zoned or used</SelectItem>
                      {ZONING_FILTER_ORDER.map((z) => (
                        <SelectItem key={z} value={z}>
                          {z === 'industrial' ? 'Industrial (incl. CI)' : zoningKindLabels[z]}
                        </SelectItem>
                      ))}
                      <SelectItem value="non_industrial">Not industrial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {/* Condo units are out by default — canvassing wants buildings, not the 236
                  separately-owned garage bays inside one of them. */}
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={includeCondos}
                  onCheckedChange={(v) => setIncludeCondos(v === true)}
                />
                Include condo units
                {!includeCondos && condoHidden > 0 && (
                  <span className="text-xs text-muted-foreground">
                    ({condoHidden.toLocaleString()} hidden)
                  </span>
                )}
              </label>
              <div className="space-y-1.5">
                <Label>Last sold</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Hide sold in the last</span>
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    value={soldYears}
                    onChange={(e) => setSoldYears(e.target.value)}
                    placeholder="off"
                    className="h-8 w-20"
                  />
                  <span className="text-sm text-muted-foreground">years</span>
                </div>
                {soldFilterOn && (
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <Checkbox
                      checked={includeNoSale}
                      onCheckedChange={(v) => setIncludeNoSale(v === true)}
                    />
                    Include properties with no sold date
                  </label>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Owner operators</Label>
                <div className="flex gap-1">
                  {(
                    [
                      ['all', 'Include'],
                      ['hide', 'Hide'],
                      ['only', 'Only'],
                    ] as const
                  ).map(([v, label]) => (
                    <Button
                      key={v}
                      size="sm"
                      variant={ownerOccMode === v ? 'default' : 'outline'}
                      className="h-7 px-2 text-xs"
                      onClick={() => setOwnerOccMode(v)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              {/* The picker lives in the rail on the map; the popover carries it for the table. */}
              {view === 'table' && <DorCodePicker selection={dorSel} onChange={setDorSel} />}
              {view === 'table' && (
                <div className="space-y-1.5">
                  <Label>Verified owner</Label>
                  <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any</SelectItem>
                      <SelectItem value="verified">Verified</SelectItem>
                      {/* same word as the rail's segmented control — one control, two
                          surfaces, and they must read the same */}
                      <SelectItem value="unverified">Not verified</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {view === 'table' && (
                <div className="space-y-1.5">
                  <Label>Recent activity</Label>
                  <Select value={activity} onValueChange={setActivity}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any</SelectItem>
                      <SelectItem value="recent">Touched in 30d</SelectItem>
                      <SelectItem value="quiet">Quiet 30d+</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {countyApplies && (
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
              )}
              {view === 'table' && (
                <div className="space-y-1.5">
                  <Label>Gross SF</Label>
                  <div className="flex items-center gap-2">
                    <CurrencyInput placeholder="Min"  value={sfMin} onValueChange={setSfMin} />
                    <span className="text-muted-foreground">–</span>
                    <CurrencyInput placeholder="Max"  value={sfMax} onValueChange={setSfMax} />
                  </div>
                </div>
              )}
              {view === 'table' && (
              <div className="space-y-1.5">
                <Label>Land acres</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" inputMode="decimal" placeholder="Min" value={acMin} onChange={(e) => setAcMin(e.target.value)} />
                  <span className="text-muted-foreground">–</span>
                  <Input type="number" inputMode="decimal" placeholder="Max" value={acMax} onChange={(e) => setAcMax(e.target.value)} />
                </div>
              </div>
              )}
              <>
              <div className="space-y-1.5 border-t pt-3">
                <Label>Lease expires (months)</Label>
                {/^\d{4}-\d{2}$/.test(leaseMonth) ? (
                  // Arrived by clicking a bar on the dashboard graph. That is one calendar
                  // month, which a rolling min/max cannot express — so show it as its own
                  // removable state instead of pretending the number inputs describe it.
                  <div className="flex items-center justify-between rounded-md border px-2 py-1.5">
                    <span className="text-sm">
                      Expiring {format(new Date(`${leaseMonth}-01T00:00:00`), 'MMMM yyyy')}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => setLeaseMonth('')}>
                      Clear
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <Input type="number" inputMode="numeric" placeholder="Now" value={leaseMin} onChange={(e) => setLeaseMin(e.target.value)} />
                      <span className="text-muted-foreground">–</span>
                      <Input type="number" inputMode="numeric" placeholder="Max" value={leaseMax} onChange={(e) => setLeaseMax(e.target.value)} />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[1, 3, 6, 12].map((n) => (
                        <Button
                          key={n}
                          variant={leaseMin === '' && leaseMax === String(n) ? 'secondary' : 'outline'}
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setLeaseMin('')
                            setLeaseMax(String(n))
                          }}
                        >
                          ≤ {n === 12 ? '1 yr' : `${n} mo`}
                        </Button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="space-y-1.5 border-t pt-3">
                <Label>Lease signed (months ago)</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" inputMode="numeric" placeholder="0" value={signMin} onChange={(e) => setSignMin(e.target.value)} />
                  <span className="text-muted-foreground">–</span>
                  <Input type="number" inputMode="numeric" placeholder="Any" value={signMax} onChange={(e) => setSignMax(e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[6, 12, 24, 36].map((n) => (
                    <Button
                      key={n}
                      variant={signMin === '' && signMax === String(n) ? 'secondary' : 'outline'}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setSignMin('')
                        setSignMax(String(n))
                      }}
                    >
                      last {n < 12 ? `${n} mo` : `${n / 12} yr`}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Recent comps for pricing. Includes leases that have already expired.
                </p>
              </div>
              <div className="space-y-1.5 border-t pt-3">
                <Label>Leased SF</Label>
                <div className="flex items-center gap-2">
                  <CurrencyInput placeholder="Min"  value={leaseSfMin} onValueChange={setLeaseSfMin} />
                  <span className="text-muted-foreground">–</span>
                  <CurrencyInput placeholder="Max"  value={leaseSfMax} onValueChange={setLeaseSfMax} />
                </div>
                <p className="text-xs text-muted-foreground">
                  The unit that was let, not the building around it.
                </p>
              </div>
              <div className="space-y-1.5 border-t pt-3">
                <Label>Decision maker</Label>
                <Select value={dmFilter} onValueChange={setDmFilter}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any</SelectItem>
                    <SelectItem value="verified">Verified decision maker</SelectItem>
                    <SelectItem value="unverified">No verified decision maker</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Verified = you spoke to the person at the tenant who makes the call.
                </p>
              </div>
              </>
              <div className="flex justify-end border-t pt-2">
                <Button variant="ghost" size="sm" onClick={clearFilters} disabled={activeFilterCount === 0}>
                  Clear all
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          )}
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
              {/* Lease columns are driven by the lease window, not chosen here — offering
                  a checkbox that the filter overrides would just be a lie. */}
              {COLUMN_DEFS.filter((c) => !LEASE_COLUMNS.includes(c.id)).map((c) => {
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

      {/* "of the book" only means something when the book is loaded. On the map the
          top bar's count answers this, and under a search the book was never fetched —
          there is no denominator to quote. */}
      {view === 'table' && !isLoading && !isError && !viewportOnly && !searchOnly && (properties ?? []).length > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {(properties ?? []).length} properties
          {condoSuffix}
        </p>
      )}
      {/* mapSearch.isError too: the list below renders its own error state, and a
          "0 matching" line above it would contradict that. */}
      {!isError && !mapSearch.isError && searchOnly && view === 'table' && !searching && (
        <p className="text-xs text-muted-foreground">
          {filtered.length.toLocaleString()} matching “{search.trim()}”{condoSuffix}
          {mapSearch.searchCapped && ` — first ${MAP_SEARCH_LIMIT.toLocaleString()}, narrow the search`}
        </p>
      )}

      {/* The map loads what the camera is pointed at, not the book: tiles and pins are
          both there within a moment of opening, at any zoom, with nothing to type first. */}
      {view === 'map' && !isError ? (
        // The rail beside the map, Mapwise-style: every filter in a fixed-width left
        // panel with its own scroll, the map filling the rest. Phone gets the same
        // rail in a bottom sheet (the "Map filters" button in the top bar).
        <div className="flex items-start gap-3">
          <div className="hidden max-h-[80vh] w-[300px] shrink-0 overflow-y-auto rounded-lg border bg-muted/20 p-3 md:block">
            {railContent}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
          {/* The phone can't see the top bar's count (lg:), so it rides above the map. */}
          <p className="text-sm text-muted-foreground lg:hidden">{mapStatusText}</p>
          {portfolioOwnerId && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-accent/40 p-2.5">
          <p className="text-sm">
            <span className="font-medium">{portfolioOwnerName ?? 'Portfolio'}</span>
            <span className="text-muted-foreground">
              {' — '}
              {filtered.length} propert{filtered.length === 1 ? 'y' : 'ies'} owned — other
              filters are paused so the whole portfolio shows
            </span>
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const next = new URLSearchParams(searchParams)
              next.delete('owner')
              setSearchParams(next, { replace: true })
            }}
          >
            <X className="size-4" />
            Leave portfolio
          </Button>
        </div>
      )}

      <PropertiesMap
            properties={filtered}
            parcelProperties={parcelSource}
            // Portfolio View: zoom to the owner's pins even when a saved viewport
            // would normally suppress the mount-time fit.
            fitKey={portfolioOwnerId ?? undefined}
            // Only the viewport fetch knows how many properties the box really holds; on
            // the query path `filtered` IS the whole answer, so there is no wider total.
            // Minus what the condo lens dropped — "1 of 241 here" would promise 237 pins
            // that zooming can never produce.
            totalInView={
              viewportOnly ? Math.max(0, mapView.data.totalInView - condoHidden) : undefined
            }
            onViewportChange={setViewport}
            emptyHint={
              searchOnly
                ? searching
                  ? 'Searching…'
                  : mapSearch.isError
                    ? 'Could not run that search — try again.'
                    : filtered.length === 0
                      ? condoHidden > 0
                        ? `Only condo units match “${search.trim()}” (${condoHidden.toLocaleString()} hidden) — turn on “Include condo units” to see them.`
                        : `Nothing matches “${search.trim()}”.`
                      : undefined
                : hasQuery
                  ? isLoading
                    ? 'Loading the book to filter it…'
                    : filtered.length === 0
                      ? condoHidden > 0
                        ? `Only condo units match (${condoHidden.toLocaleString()} hidden) — turn on “Include condo units” to see them.`
                        : 'Nothing matches the current search/filters.'
                      : undefined
                  : mapView.isError
                    ? 'Could not load the properties in this area — pan to retry.'
                    : mapView.isFetching
                      ? 'Loading the properties in view…'
                      : condoHidden > 0
                        ? `Only condo units here (${condoHidden.toLocaleString()} hidden) — turn on “Include condo units” to see them.`
                        : 'No properties here yet — pan or zoom out to find some.'
            }
            goodDealIds={goodDealIds}
            executedIds={executedIds}
            ownerContext={mapOwnerCtx}
            // The tenant hover-card follows the lease QUESTION, not a lens: only while
            // a lease window narrows the set does the pin name who is leaving.
            leaseInfo={leaseMatchIds ? leaseSoonest : undefined}
            polygon={polygon}
            draft={draft}
            drawMode={drawMode}
            asking={askingMap}
            industrialCrossovers={crossovers}
            overlays={overlays}
            onAddVertex={(lat, lng) => setDraft((d) => [...(d ?? []), { lat, lng }])}
            onFinishShape={() => {
              if ((draft?.length ?? 0) >= 3) {
                setPolygon(draft)
                setDraft(null)
              }
            }}
          />
          </div>
        </div>
      ) : isLoading || searching ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError || (searchOnly && mapSearch.isError) ? (
        <ListErrorState message="Could not load properties." onRetry={() => refetch()} />
      ) : /* Under a search the book is never fetched, so its emptiness says nothing about
            whether Alex has any properties — only that he hasn't loaded them. */
        !searchOnly && (properties ?? []).length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No properties yet — use “Add property” above to add the buildings and land you're working.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          {condoHidden > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Only condo units match — {condoHidden.toLocaleString()} hidden by the condo filter.
              </p>
              <Button variant="outline" size="sm" onClick={() => setIncludeCondos(true)}>
                Include condo units
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No properties match “{search.trim()}”</p>
          )}
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
                        {c.cell(
                          property,
                          askingMap?.get(property.id),
                          ownerCtx?.get(property.id),
                          leaseMatch?.top.get(property.id),
                        )}
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

      <OwnerOutreachDialog
        open={ownerMsgOpen}
        onOpenChange={setOwnerMsgOpen}
        recipients={ownerRecipients}
      />

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        rows={filtered}
        ownerCtx={ownerCtx}
        asking={askingMap}
        getLease={getExportLease}
        onLeaseNeeded={() => setExportWantsLeases(true)}
        crossovers={crossovers}
      />

      <PushToGhlDialog

        open={pushOpen}

        onOpenChange={setPushOpen}

        contacts={pushable}

        skippedCount={skippedIds.length}

        onDownloadSkipped={exportSkipped}

      />

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
