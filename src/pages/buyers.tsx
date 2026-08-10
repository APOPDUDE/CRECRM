import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, Plus, Search, SlidersHorizontal, Timer, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { AddBuyerDialog } from '@/components/add-buyer-dialog'
import { ChipRow } from '@/components/buyer-criteria-fields'
import { ListErrorState } from '@/components/list-error-state'
import { useTenantReps } from '@/hooks/use-tenant-reps'
import type { TenantRepWithRelations } from '@/hooks/use-tenant-reps'
import { usePropertyPointSearch, type PropertyPoint } from '@/hooks/use-buyers'
import { usePersistentState } from '@/hooks/use-persistent-state'
import {
  areasCoverPoint,
  buyerKindLabels,
  buyerKinds,
  daysUntil,
  industrialSubclassHints,
  industrialSubclassLabels,
  industrialSubclasses,
  investmentStrategies,
  investmentStrategyLabels,
  isBuyerClient,
  parseTargetAreas,
} from '@/lib/clients'
import type { Enums } from '@/lib/database.types'
import { formatCurrency, formatSf, numOrNull } from '@/lib/format'
import { clientStatusLabels, livePursuits } from '@/lib/stages'
import { cn } from '@/lib/utils'

type Subclass = Enums<'industrial_subclass'>
type Strategy = Enums<'investment_strategy'>
type Kind = Enums<'buyer_kind'>
type StatusFilter = 'open' | 'lost' | 'all'

/** Strategy column for buyers who never named one — mostly owner-users. */
const ANY_STRATEGY = '__any__'
type StrategyPick = Strategy | typeof ANY_STRATEGY

/** All / only the 1031 buyers / everyone except them. */
type ExchangeFilter = 'all' | 'only' | 'exclude'

const strategyPickLabels: Record<StrategyPick, string> = {
  ...investmentStrategyLabels,
  [ANY_STRATEGY]: 'No strategy',
}

function buyerName(b: TenantRepWithRelations): string {
  if (b.company?.name) return b.company.name
  const person = [b.contact?.first_name, b.contact?.last_name].filter(Boolean).join(' ')
  return person || 'Untitled buyer'
}

function priceRange(min: number | null, max: number | null): string | null {
  const lo = formatCurrency(min)
  const hi = formatCurrency(max)
  if (lo && hi) return `${lo} – ${hi}`
  if (lo) return `${lo}+`
  if (hi) return `Up to ${hi}`
  return null
}

function sizeRange(b: TenantRepWithRelations): string | null {
  const sf = [formatSf(b.building_sf_min), formatSf(b.building_sf_max)].filter(Boolean)
  const ac = [b.land_acres_min, b.land_acres_max].filter((n) => n != null)
  const parts: string[] = []
  if (sf.length) parts.push(sf.join(' – '))
  if (ac.length) parts.push(`${ac.join(' – ')} AC`)
  return parts.length ? parts.join(' · ') : null
}

const toggle = <T,>(list: T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v]

const num = (v: string): number | null => numOrNull(v)

/** Small badge list that collapses past three so a row stays one line. */
function BadgeList({ items }: { items: string[] }) {
  if (!items.length) return <span className="text-muted-foreground">—</span>
  const shown = items.slice(0, 3)
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((t) => (
        <Badge key={t} variant="outline" className="font-normal">
          {t}
        </Badge>
      ))}
      {items.length > shown.length && (
        <span className="text-xs text-muted-foreground">+{items.length - shown.length}</span>
      )}
    </div>
  )
}

/** Countdown on a 1031 clock. Under 60 days is red — that money has to move. */
function ExchangeBadge({ deadline }: { deadline: string | null }) {
  const days = daysUntil(deadline)
  if (days == null) {
    return (
      <Badge variant="outline" className="border-amber-300 font-normal text-amber-700">
        1031
      </Badge>
    )
  }
  const overdue = days < 0
  return (
    <Badge
      variant="outline"
      className={cn(
        'font-normal',
        overdue || days < 60
          ? 'border-red-300 bg-red-50 text-red-700'
          : 'border-amber-300 bg-amber-50 text-amber-700',
      )}
    >
      {overdue ? 'Expired' : `${days}d`}
    </Badge>
  )
}

export function BuyersPage() {
  const navigate = useNavigate()
  const buyersQ = useTenantReps()

  const [addOpen, setAddOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [subclasses, setSubclasses] = usePersistentState<Subclass[]>('buyers:subclasses', [])
  const [strategies, setStrategies] = usePersistentState<StrategyPick[]>('buyers:strategies2', [])
  const [kinds, setKinds] = usePersistentState<Kind[]>('buyers:kinds', [])
  const [exchange, setExchange] = usePersistentState<ExchangeFilter>('buyers:exchange', 'all')
  const [status, setStatus] = usePersistentState<StatusFilter>('buyers:status', 'open')
  const [priceMin, setPriceMin] = usePersistentState('buyers:priceMin', '')
  const [priceMax, setPriceMax] = usePersistentState('buyers:priceMax', '')
  const [sfMin, setSfMin] = usePersistentState('buyers:sfMin', '')
  const [acresMin, setAcresMin] = usePersistentState('buyers:acresMin', '')
  const [dealCapRate, setDealCapRate] = usePersistentState('buyers:dealCapRate', '')

  // "Who buys here?" — pick the property a deal just landed on.
  const [placeQuery, setPlaceQuery] = useState('')
  const [place, setPlace] = useState<PropertyPoint | null>(null)
  const placeResults = usePropertyPointSearch(placeQuery)

  const all = useMemo(
    () => (buyersQ.data ?? []).filter(isBuyerClient),
    [buyersQ.data],
  )

  // Status gate first: the matrix and the 1031 strip both describe the live roster,
  // not lost records.
  const inScope = useMemo(
    () =>
      all.filter((b) =>
        status === 'all' ? true : status === 'lost' ? b.status === 'lost' : b.status !== 'lost',
      ),
    [all, status],
  )

  const exchangeBuyers = useMemo(
    () =>
      all
        .filter((b) => b.exchange_1031 && b.status !== 'lost')
        .sort((a, b) => {
          const da = daysUntil(a.exchange_deadline) ?? Number.POSITIVE_INFINITY
          const db = daysUntil(b.exchange_deadline) ?? Number.POSITIVE_INFINITY
          return da - db
        }),
    [all],
  )

  const filterCount =
    (priceMin ? 1 : 0) +
    (priceMax ? 1 : 0) +
    (sfMin ? 1 : 0) +
    (acresMin ? 1 : 0) +
    (dealCapRate ? 1 : 0) +
    (status !== 'open' ? 1 : 0)

  const filtered = useMemo(() => {
    const tokens = search.toLowerCase().split(/\s+/).filter(Boolean)
    const pMin = num(priceMin)
    const pMax = num(priceMax)
    const wantSf = num(sfMin)
    const wantAcres = num(acresMin)
    const capOffered = num(dealCapRate)

    return inScope.filter((b) => {
      if (subclasses.length && !subclasses.some((s) => b.product_subclasses.includes(s))) return false
      // "No strategy" is a pick like any other, so a row can be read as
      // value-add OR stabilized OR nobody-said.
      if (strategies.length) {
        const hit = strategies.some((s) =>
          s === ANY_STRATEGY ? b.strategies.length === 0 : b.strategies.includes(s),
        )
        if (!hit) return false
      }
      if (kinds.length && !(b.buyer_kind && kinds.includes(b.buyer_kind))) return false
      if (exchange === 'only' && !b.exchange_1031) return false
      if (exchange === 'exclude' && b.exchange_1031) return false

      // Price filters describe the DEAL: keep buyers whose range can absorb it.
      if (pMin != null && b.price_max != null && b.price_max < pMin) return false
      if (pMax != null && b.price_min != null && b.price_min > pMax) return false
      // Same for size — a buyer whose floor is above the building is out.
      if (wantSf != null && b.building_sf_min != null && b.building_sf_min > wantSf) return false
      if (wantAcres != null && b.land_acres_min != null && b.land_acres_min > wantAcres) return false
      // A deal's cap rate has to clear the buyer's minimum.
      if (capOffered != null && b.cap_rate_min != null && b.cap_rate_min > capOffered) return false

      if (place) {
        const areas = parseTargetAreas(b.target_areas)
        if (!areas.length) return false
        if (!areasCoverPoint(areas, place.lat, place.lng)) return false
      }

      if (tokens.length) {
        const hay = [
          buyerName(b),
          b.contact?.first_name,
          b.contact?.last_name,
          b.target_markets,
          b.must_haves,
          b.intended_use,
          ...parseTargetAreas(b.target_areas).map((a) => a.name),
          ...b.product_subclasses.map((s) => industrialSubclassLabels[s]),
          ...b.strategies.map((s) => investmentStrategyLabels[s]),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!tokens.every((t) => hay.includes(t))) return false
      }
      return true
    })
  }, [
    inScope,
    subclasses,
    strategies,
    kinds,
    exchange,
    priceMin,
    priceMax,
    sfMin,
    acresMin,
    dealCapRate,
    place,
    search,
  ])

  // Coverage matrix: how many live buyers want each product × strategy combination, and
  // just as usefully, where the roster is empty.
  const matrix = useMemo(() => {
    const counts = new Map<string, number>()
    for (const b of inScope) {
      if (b.status === 'lost') continue
      const cols: string[] = b.strategies.length ? b.strategies : [ANY_STRATEGY]
      for (const sub of b.product_subclasses) {
        for (const col of cols) counts.set(`${sub}|${col}`, (counts.get(`${sub}|${col}`) ?? 0) + 1)
      }
    }
    return counts
  }, [inScope])

  const matrixColumns: StrategyPick[] = [...investmentStrategies, ANY_STRATEGY]

  /**
   * Cells accumulate rather than replace: click small bay × value add, then small bay ×
   * no strategy, and you are looking at both. Clicking a lit cell takes its strategy
   * back out; the product stays until you clear its chip.
   */
  const toggleCell = (sub: Subclass, col: StrategyPick) => {
    setSubclasses((prev) => (prev.includes(sub) ? prev : [...prev, sub]))
    setStrategies((prev) => (prev.includes(col) ? prev.filter((x) => x !== col) : [...prev, col]))
  }

  const cellActive = (sub: Subclass, col: StrategyPick) =>
    subclasses.includes(sub) && strategies.includes(col)

  const clearAll = () => {
    setSubclasses([])
    setStrategies([])
    setKinds([])
    setExchange('all')
    setStatus('open')
    setPriceMin('')
    setPriceMax('')
    setSfMin('')
    setAcresMin('')
    setDealCapRate('')
    setPlace(null)
    setPlaceQuery('')
    setSearch('')
  }

  const anyFilter =
    filterCount > 0 ||
    subclasses.length > 0 ||
    strategies.length > 0 ||
    kinds.length > 0 ||
    exchange !== 'all' ||
    !!place ||
    !!search

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Buyers</h1>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          Add buyer
        </Button>
      </div>

      {/* Deal just hit: name the property, get the buyers whose areas cover it. */}
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <MapPin className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Who buys here?</span>
          {place ? (
            <Badge variant="secondary" className="gap-1 font-normal">
              {place.address}
              {place.lat == null || place.lng == null ? ' (no coordinates)' : ''}
              <button
                type="button"
                onClick={() => setPlace(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Clear property"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ) : (
            <div className="relative w-full max-w-sm">
              <Input
                value={placeQuery}
                onChange={(e) => setPlaceQuery(e.target.value)}
                placeholder="Search a property address…"
                className="h-8"
              />
              {placeQuery.trim().length >= 3 && (placeResults.data?.length ?? 0) > 0 && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
                  {placeResults.data!.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPlace(p)
                        setPlaceQuery('')
                      }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      {p.address}
                      <span className="text-muted-foreground">
                        {p.city ? ` · ${p.city}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {place && (place.lat == null || place.lng == null) && (
            <span className="text-xs text-muted-foreground">
              This property has no coordinates yet, so nobody can match on area.
            </span>
          )}
        </div>
      </div>

      {/* Coverage matrix — where the buyer list is deep, and where it's empty. */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[42rem] text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Coverage</th>
              {matrixColumns.map((c) => (
                <th key={c} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
                  {c === ANY_STRATEGY ? 'No strategy' : investmentStrategyLabels[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {industrialSubclasses.map((sub) => (
              <tr key={sub} className="border-b last:border-0">
                <td className="px-3 py-1.5 font-medium">
                  {industrialSubclassLabels[sub]}
                  {industrialSubclassHints[sub] && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {industrialSubclassHints[sub]}
                    </span>
                  )}
                </td>
                {matrixColumns.map((col) => {
                  const count = matrix.get(`${sub}|${col}`) ?? 0
                  const active = cellActive(sub, col)
                  return (
                    <td key={col} className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => toggleCell(sub, col)}
                        className={cn(
                          'w-full rounded px-2 py-1 text-sm tabular-nums transition-colors',
                          count === 0
                            ? 'text-muted-foreground/40 hover:bg-muted'
                            : 'bg-primary/10 font-medium text-primary hover:bg-primary/20',
                          active && 'ring-2 ring-primary ring-offset-1',
                        )}
                      >
                        {count || '·'}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <ChipRow
          values={industrialSubclasses}
          labels={industrialSubclassLabels}
          selected={subclasses}
          onToggle={(v) => setSubclasses(toggle(subclasses, v))}
        />
        <ChipRow
          values={matrixColumns}
          labels={strategyPickLabels}
          selected={strategies}
          onToggle={(v) => setStrategies(toggle(strategies, v))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search buyers…"
            className="h-9 pl-8"
          />
        </div>

        <ChipRow
          values={buyerKinds}
          labels={buyerKindLabels}
          selected={kinds}
          onToggle={(v) => setKinds(toggle(kinds, v))}
        />

        {/* Same row as the buyer kinds, because that is what it is — one more facet.
            Three states so it can also take the 1031 buyers OUT of the list. */}
        <div className="flex items-center rounded-full border p-0.5">
          {(
            [
              ['all', 'All'],
              ['only', '1031 only'],
              ['exclude', 'Hide 1031'],
            ] as [ExchangeFilter, string][]
          ).map(([v, label]) => (
            <Button
              key={v}
              type="button"
              variant={exchange === v ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                'h-6 rounded-full px-2.5 text-xs font-normal',
                exchange === v && 'font-medium',
              )}
              onClick={() => setExchange(v)}
            >
              {v === 'only' && <Timer className="size-3.5" />}
              {label}
              {v === 'only' && exchangeBuyers.length > 0 && (
                <span className="ml-1 tabular-nums text-muted-foreground">
                  {exchangeBuyers.length}
                </span>
              )}
            </Button>
          ))}
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              <SlidersHorizontal className="size-4" />
              Filters
              {filterCount > 0 && (
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                  {filterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Deal price</Label>
              <div className="grid grid-cols-2 gap-2">
                <CurrencyInput
                  placeholder="Min $"
                  
                value={priceMin} onValueChange={setPriceMin} />
                <CurrencyInput
                  placeholder="Max $"
                  
                value={priceMax} onValueChange={setPriceMax} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Building SF</Label>
                <CurrencyInput
                  placeholder="e.g. 25000"
                  
                value={sfMin} onValueChange={setSfMin} />
              </div>
              <div className="space-y-1.5">
                <Label>Acres</Label>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 2.5"
                  value={acresMin}
                  onChange={(e) => setAcresMin(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Deal cap rate (%)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="e.g. 7.0"
                value={dealCapRate}
                onChange={(e) => setDealCapRate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Shows buyers whose minimum cap rate this deal clears.
              </p>
            </div>
            <Button variant="ghost" size="sm" className="w-full" onClick={clearAll}>
              Clear all
            </Button>
          </PopoverContent>
        </Popover>

        <span className="text-sm text-muted-foreground tabular-nums">
          {filtered.length} of {inScope.length}
        </span>
      </div>

      {buyersQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : buyersQ.isError ? (
        <ListErrorState message="Could not load buyers." onRetry={() => buyersQ.refetch()} />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {all.length === 0
              ? 'No buyers yet — add one to start the roster.'
              : anyFilter
                ? 'No buyer matches these criteria.'
                : 'No buyers here.'}
          </p>
          {all.length === 0 ? (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Add buyer
            </Button>
          ) : (
            anyFilter && (
              <Button variant="outline" onClick={clearAll}>
                Clear filters
              </Button>
            )
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Areas</TableHead>
                  <TableHead>1031</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>In play</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((b) => (
                  <TableRow
                    key={b.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/tenant-rep/${b.id}`)}
                  >
                    <TableCell className="font-medium">{buyerName(b)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {b.buyer_kind ? buyerKindLabels[b.buyer_kind] : '—'}
                    </TableCell>
                    <TableCell>
                      <BadgeList items={b.product_subclasses.map((s) => industrialSubclassLabels[s])} />
                    </TableCell>
                    <TableCell>
                      <BadgeList items={b.strategies.map((s) => investmentStrategyLabels[s])} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {priceRange(b.price_min, b.price_max) ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{sizeRange(b) ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {parseTargetAreas(b.target_areas)
                        .map((a) => a.name)
                        .join(', ') || '—'}
                    </TableCell>
                    <TableCell>
                      {b.exchange_1031 ? <ExchangeBadge deadline={b.exchange_deadline} /> : '—'}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'text-xs',
                          b.status === 'lost' ? 'text-red-600' : 'text-muted-foreground',
                        )}
                      >
                        {clientStatusLabels[b.status]}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">{livePursuits(b.matches).length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Phone: the same record as a card */}
          <div className="space-y-2 md:hidden">
            {filtered.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => navigate(`/tenant-rep/${b.id}`)}
                className="w-full rounded-lg border p-3 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{buyerName(b)}</span>
                  {b.exchange_1031 && <ExchangeBadge deadline={b.exchange_deadline} />}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {[
                    b.buyer_kind ? buyerKindLabels[b.buyer_kind] : null,
                    priceRange(b.price_min, b.price_max),
                    sizeRange(b),
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'No criteria captured'}
                </div>
                <div className="mt-2">
                  <BadgeList
                    items={[
                      ...b.product_subclasses.map((s) => industrialSubclassLabels[s]),
                      ...b.strategies.map((s) => investmentStrategyLabels[s]),
                    ]}
                  />
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <AddBuyerDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  )
}
