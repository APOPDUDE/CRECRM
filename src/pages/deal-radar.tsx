import { useState } from 'react'
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
  useDealRadarLocations,
  useDealRadarStats,
  type DealRadarFilters,
  type DealRadarIntent,
  type DealRadarType,
} from '@/hooks/use-deal-radar'
import { INTENT_ORDER, intentLabels, isRunStale, typeLabels } from '@/lib/deal-radar'
import { numOrNull } from '@/lib/format'

type RadarView = 'all' | 'fbm' | 'groups' | 'approved' | 'declined'

const VIEW_TABS: { value: RadarView; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'fbm', label: 'FBM' },
  { value: 'groups', label: 'Groups' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
]

/**
 * Deal Radar — new industrial/land listings pulled off Facebook Marketplace and
 * CRE groups by the Mac worker, surfaced for one-click, human-sent outreach.
 * Segmented by source (FBM / Groups), with Dead its own bucket. More tabs later.
 */
export function DealRadarPage() {
  const [view, setView] = useState<RadarView>('all')
  const [location, setLocation] = useState<string>('all')
  const [type, setType] = useState<DealRadarType | 'all'>('all')
  const [intent, setIntent] = useState<DealRadarIntent | 'all'>('all')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [minSqft, setMinSqft] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)

  const filters: DealRadarFilters = {
    // All / FBM / Groups show the untriaged set; Approved and Declined are their own views.
    status:
      view === 'declined' ? 'declined' : view === 'approved' ? 'approved_bucket' : 'open',
    source: view === 'fbm' ? 'marketplace' : view === 'groups' ? 'group' : null,
    location: location === 'all' ? null : location,
    type: type === 'all' ? null : type,
    intent: intent === 'all' ? null : intent,
    minPrice: numOrNull(minPrice),
    maxPrice: numOrNull(maxPrice),
    minSqft: numOrNull(minSqft),
  }

  const { data: rows = [], isLoading, isError, refetch } = useDealRadar(filters)
  const { data: stats } = useDealRadarStats()
  const { data: lastRun } = useDealRadarLatestRun()
  const { data: locations = [] } = useDealRadarLocations()

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

      {/* Worker health strip */}
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
      </div>

      {/* Source tabs: FBM / Groups / Dead (+ All) */}
      <div className="flex flex-wrap gap-1.5">
        {VIEW_TABS.map((t) => (
          <Button
            key={t.value}
            size="sm"
            variant={view === t.value ? 'default' : 'outline'}
            onClick={() => setView(t.value)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={location} onValueChange={setLocation}>
          <SelectTrigger className="h-9 w-[200px]">
            <SelectValue placeholder="Location" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locations.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
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

        <Select value={intent} onValueChange={(v) => setIntent(v as DealRadarIntent | 'all')}>
          <SelectTrigger className="h-9 w-[160px]">
            <SelectValue placeholder="Sale / lease" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Sale &amp; lease</SelectItem>
            {INTENT_ORDER.map((i) => (
              <SelectItem key={i} value={i}>
                {intentLabels[i]}
              </SelectItem>
            ))}
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
          {view === 'declined'
            ? 'Nothing declined yet.'
            : view === 'approved'
              ? 'Nothing approved yet — approve a listing to line it up for a deal.'
              : 'No listings match this filter yet. The worker polls every 3 hours.'}
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
