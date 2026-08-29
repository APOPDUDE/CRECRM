import { useMemo, useState } from 'react'
import { AlertTriangle, Radar, RefreshCw } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { DealRadarCard } from '@/components/deal-radar-card'
import { DealRadarDetail } from '@/components/deal-radar-detail'
import { ListErrorState } from '@/components/list-error-state'
import {
  useDealRadar,
  useDealRadarLatestRun,
  useDealRadarStats,
  type DealRadarFilters,
  type DealRadarSource,
  type DealRadarStatus,
  type DealRadarType,
} from '@/hooks/use-deal-radar'
import { isRunStale, statusLabels, typeLabels } from '@/lib/deal-radar'
import { numOrNull } from '@/lib/format'

const STATUS_TABS: { value: DealRadarStatus | 'open'; label: string }[] = [
  { value: 'open', label: 'Working' },
  { value: 'new', label: 'New' },
  { value: 'messaged', label: 'Messaged' },
  { value: 'replied', label: 'Replied' },
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'converted', label: 'Converted' },
  { value: 'dead', label: 'Dead' },
]

/**
 * Deal Radar — new industrial/land listings pulled off Facebook Marketplace by
 * the Mac worker, surfaced for one-click, human-sent outreach. Cards default to
 * the New column, newest first.
 */
export function DealRadarPage() {
  const [status, setStatus] = useState<DealRadarStatus | 'open'>('new')
  const [market, setMarket] = useState<string>('all')
  const [type, setType] = useState<DealRadarType | 'all'>('all')
  const [source, setSource] = useState<DealRadarSource | 'all'>('all')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [minSqft, setMinSqft] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)

  const filters: DealRadarFilters = {
    status,
    market: market === 'all' ? null : market,
    type: type === 'all' ? null : type,
    source: source === 'all' ? null : source,
    minPrice: numOrNull(minPrice),
    maxPrice: numOrNull(maxPrice),
    minSqft: numOrNull(minSqft),
  }

  const { data: rows = [], isLoading, isError, refetch } = useDealRadar(filters)
  const { data: stats } = useDealRadarStats()
  const { data: lastRun } = useDealRadarLatestRun()

  // Market options: whatever markets the DB has actually produced.
  const markets = useMemo(() => {
    const set = new Set<string>(stats ? [...stats.byMarket.keys()] : [])
    for (const r of rows) set.add(r.market)
    return [...set].sort()
  }, [rows, stats])

  const runStale = isRunStale(lastRun?.started_at)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Radar className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">Deal Radar</h1>
          {stats && stats.newToday > 0 && (
            <Badge className="bg-blue-600 text-white">{stats.newToday} new today</Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="size-4" />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* Worker health + per-market new-lead badges */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {lastRun ? (
          <span className={runStale ? 'text-amber-600' : undefined}>
            {runStale && <AlertTriangle className="mr-1 inline size-3" />}
            Last poll {formatDistanceToNow(new Date(lastRun.started_at))} ago
            {lastRun.errors > 0 && ` · ${lastRun.errors} error${lastRun.errors > 1 ? 's' : ''}`}
            {lastRun.ok === false && ' · aborted'}
          </span>
        ) : (
          <span>Worker has not reported a poll yet.</span>
        )}
        {stats &&
          markets
            .filter((m) => (stats.byMarket.get(m) ?? 0) > 0)
            .map((m) => (
              <Badge key={m} variant="secondary" className="font-normal">
                {m}: {stats.byMarket.get(m)}
              </Badge>
            ))}
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
          </Button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={market} onValueChange={setMarket}>
          <SelectTrigger className="h-9 w-[190px]">
            <SelectValue placeholder="Market" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All markets</SelectItem>
            {markets.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={type} onValueChange={(v) => setType(v as DealRadarType | 'all')}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="industrial">{typeLabels.industrial}</SelectItem>
            <SelectItem value="land">{typeLabels.land}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={source} onValueChange={(v) => setSource(v as DealRadarSource | 'all')}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="marketplace">Marketplace</SelectItem>
            <SelectItem value="group">Groups</SelectItem>
          </SelectContent>
        </Select>

        <Input
          className="h-9 w-28"
          inputMode="numeric"
          placeholder="Min $"
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
        />
        <Input
          className="h-9 w-28"
          inputMode="numeric"
          placeholder="Max $"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
        />
        <Input
          className="h-9 w-32"
          inputMode="numeric"
          placeholder="Min SF"
          value={minSqft}
          onChange={(e) => setMinSqft(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <ListErrorState message="Could not load Deal Radar." onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          <Radar className="mx-auto mb-2 size-6 opacity-40" />
          {status === 'new'
            ? 'No new listings in this filter yet. The worker checks every 45 minutes.'
            : `No ${status === 'open' ? 'working' : statusLabels[status as DealRadarStatus].toLowerCase()} listings match.`}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((row) => (
            <DealRadarCard key={row.id} row={row} onOpenDetail={(r) => setDetailId(r.id)} />
          ))}
        </div>
      )}

      <DealRadarDetail
        row={rows.find((r) => r.id === detailId) ?? null}
        open={detailId != null}
        onOpenChange={(o) => !o && setDetailId(null)}
      />
    </div>
  )
}
