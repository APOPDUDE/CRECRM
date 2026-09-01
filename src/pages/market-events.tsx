import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Building2,
  Check,
  ExternalLink,
  Gavel,
  HardHat,
  Landmark,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Tag,
  X,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ListErrorState } from '@/components/list-error-state'
import {
  marketSourceLabel,
  useMarketEvents,
  useMarketEventCounts,
  useMarketMonitorHealth,
  useUpdateMarketEventStatus,
  type MarketEventRow,
  type MarketEventStatus,
  type MarketEventType,
} from '@/hooks/use-market-events'

const STATUS_TABS: { value: MarketEventStatus | 'all'; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'seen', label: 'Seen' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'all', label: 'All' },
]

const TYPE_META: Record<MarketEventType, { label: string; icon: typeof HardHat }> = {
  permit: { label: 'Permit', icon: HardHat },
  sale: { label: 'Sale', icon: Tag },
  zoning_change: { label: 'Zoning', icon: Landmark },
  code_enforcement: { label: 'Code enforcement', icon: AlertTriangle },
  foreclosure: { label: 'Pre-foreclosure', icon: Gavel },
}

/** Staleness thresholds (days) mirrored from the n8n watchdog. */
function staleDaysFor(src: string): number {
  if (src === 'tampa_permits') return 5
  if (src === 'hcfl_permits') return 45
  if (src === 'hc_zoning_hearings') return 21
  if (src.startsWith('county_sales:') || src === 'hc_code_enforcement') return 12
  if (src.endsWith('_lis_pendens')) return 45 // book-owner LPs are rare; quiet stretches are normal
  return 7
}

function detailField(row: MarketEventRow, key: string): string | null {
  const d = row.detail
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    const v = (d as Record<string, unknown>)[key]
    if (typeof v === 'string' && v.trim() !== '') return v
    if (typeof v === 'number') return String(v)
  }
  return null
}

/**
 * Market Monitor — off-market events on and around the book: permits today,
 * sales and zoning changes when their sources land. The same rows the daily
 * #deals digest summarizes; this is where they get worked. 📌 = matched to a
 * book property. Triage: Seen (acknowledged) or Dismissed (noise).
 */
export function MarketEventsPage() {
  const [status, setStatus] = useState<MarketEventStatus | 'all'>('new')
  const [type, setType] = useState<MarketEventType | 'all'>('all')
  const [source, setSource] = useState<string>('all')
  const [bookOnly, setBookOnly] = useState(false)

  const filters = {
    status,
    type: type === 'all' ? null : type,
    source: source === 'all' ? null : source,
    matchedOnly: bookOnly,
  }

  const { data: rows = [], isLoading, isError, refetch } = useMarketEvents(filters)
  const { data: counts } = useMarketEventCounts()
  const { data: health } = useMarketMonitorHealth()
  const updateStatus = useUpdateMarketEventStatus()

  const sources = useMemo(() => {
    const set = new Set<string>(Object.keys(health ?? {}))
    for (const r of rows) set.add(r.source)
    return [...set].sort()
  }, [rows, health])

  const setOne = (id: string, next: MarketEventStatus) =>
    updateStatus.mutate({ ids: [id], status: next })

  const markAllSeen = () =>
    updateStatus.mutate({ ids: rows.filter((r) => r.status === 'new').map((r) => r.id), status: 'seen' })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <RadioTower className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">Market Monitor</h1>
          {counts && counts.new > 0 && (
            <Badge className="bg-blue-600 text-white">{counts.new} new</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status === 'new' && rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={markAllSeen} disabled={updateStatus.isPending}>
              <Check className="size-4" />
              <span className="hidden sm:inline">Mark all seen</span>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="size-4" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Source freshness — same numbers the n8n watchdog alerts on */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {health && Object.keys(health).length > 0 ? (
          Object.entries(health).map(([src, seconds]) => {
            const days = seconds / 86400
            const stale = days > staleDaysFor(src)
            return (
              <span key={src} className={stale ? 'text-amber-600' : undefined}>
                {stale && <AlertTriangle className="mr-1 inline size-3" />}
                {marketSourceLabel(src)}: {formatDistanceToNow(Date.now() - seconds * 1000)} ago
              </span>
            )
          })
        ) : (
          <span>No source has reported yet — the feeds run daily at 7:20am.</span>
        )}
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_TABS.map((t) => (
          <Button
            key={t.value}
            size="sm"
            variant={status === t.value ? 'default' : 'outline'}
            onClick={() => setStatus(t.value)}
          >
            {t.label}
            {counts && t.value !== 'all' && (
              <span className="ml-1 text-xs opacity-70">{counts[t.value]}</span>
            )}
          </Button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={type} onValueChange={(v) => setType(v as MarketEventType | 'all')}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {(Object.keys(TYPE_META) as MarketEventType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {TYPE_META[t].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s} value={s}>
                {marketSourceLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant={bookOnly ? 'default' : 'outline'}
          onClick={() => setBookOnly((v) => !v)}
        >
          <Building2 className="size-4" />
          On book only
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <ListErrorState message="Could not load market events." onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          <RadioTower className="mx-auto mb-2 size-6 opacity-40" />
          {status === 'new'
            ? 'No new events in this filter. The permit feeds run daily at 7:20am; sales and zoning sources come next.'
            : 'Nothing here yet.'}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <MarketEventRowItem key={row.id} row={row} onSetStatus={setOne} />
          ))}
        </div>
      )}
    </div>
  )
}

function MarketEventRowItem({
  row,
  onSetStatus,
}: {
  row: MarketEventRow
  onSetStatus: (id: string, next: MarketEventStatus) => void
}) {
  const TypeIcon = TYPE_META[row.event_type].icon
  const description = detailField(row, 'description')
  const permitStatus = detailField(row, 'status')
  const matched = row.property_id != null

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-3">
      <TypeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {matched && (
            <Badge className="bg-blue-600 text-white" title="Matched to a book property">
              📌 On book
            </Badge>
          )}
          <span className="text-sm font-medium">{row.title}</span>
        </div>
        {description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{description}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{marketSourceLabel(row.source)}</span>
          {row.event_date && <span>· {row.event_date}</span>}
          {permitStatus && <span>· {permitStatus}</span>}
          <span>· spotted {formatDistanceToNow(new Date(row.first_seen_at))} ago</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {matched && (
          <Button asChild size="sm" variant="outline">
            <Link to={`/properties/${row.property_id}`}>
              <Building2 className="size-4" />
              Property
            </Link>
          </Button>
        )}
        {row.url && (
          <Button asChild size="sm" variant="outline">
            <a href={row.url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
              Source
            </a>
          </Button>
        )}
        {row.status === 'new' && (
          <Button size="sm" variant="ghost" title="Mark seen" onClick={() => onSetStatus(row.id, 'seen')}>
            <Check className="size-4" />
          </Button>
        )}
        {row.status !== 'dismissed' ? (
          <Button size="sm" variant="ghost" title="Dismiss" onClick={() => onSetStatus(row.id, 'dismissed')}>
            <X className="size-4" />
          </Button>
        ) : (
          <Button size="sm" variant="ghost" title="Restore to New" onClick={() => onSetStatus(row.id, 'new')}>
            <RotateCcw className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
