import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, ExternalLink, RadioTower, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  marketSourceLabel,
  useMarketEventFeed,
  useUpdateMarketEventStatus,
  type MarketEventFeedView,
} from '@/hooks/use-market-events'
import {
  EVENT_TYPE_CHIP,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_ORDER,
  USE_LABELS,
  USE_ORDER,
  kindBucket,
  usageTag,
  type MarketEventType,
  type UseBucket,
} from '@/lib/market-events'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { formatPhone } from '@/lib/format'
import { cn } from '@/lib/utils'

const MAX_ROWS = 60

const VIEW_TABS: { value: MarketEventFeedView; label: string }[] = [
  { value: 'verified', label: 'Verified contact' },
  { value: 'book', label: 'In the book' },
]

/**
 * Dashboard Market Monitor: new market events you haven't marked yet — permits,
 * sales, zoning, code enforcement, foreclosure, bankruptcy, probate. Two tabs, like
 * the Facebook widget: "Verified contact" (a property whose owner you have actually
 * reached — actionable now) and "In the book" (any book property). Unmatched
 * county noise never shows here — it lives on the Market Monitor page. Slice by
 * event category and by use (industrial / land / …), each row carries a colour-coded
 * event chip and the county's use label. Mark each Seen (✓) or Dismiss (✗), or
 * "Clear all" to mark everything in the current slice seen.
 */
export function MarketMonitorWidget() {
  const [view, setView] = usePersistentState<MarketEventFeedView>('market-monitor:view', 'verified')
  const [type, setType] = usePersistentState<MarketEventType | 'all'>('market-monitor:type', 'all')
  const [use, setUse] = usePersistentState<UseBucket | 'all'>('market-monitor:use', 'all')
  const [expanded, setExpanded] = useState(false)
  const { data } = useMarketEventFeed(view)
  const updateStatus = useUpdateMarketEventStatus()

  const total = data?.total ?? 0
  // Hide only when even "In the book" is empty. When Verified is empty we still
  // render so the other tab is reachable.
  if (total === 0 && view === 'book') return null

  const rows = data?.rows ?? []
  // If a persisted slice has no rows in the current view (e.g. after switching
  // tabs), fall back to All so the list is never mysteriously empty.
  const activeType: MarketEventType | 'all' =
    type !== 'all' && !(data?.byType[type] ?? 0) ? 'all' : type
  const activeUse: UseBucket | 'all' = use !== 'all' && !(data?.byUse[use] ?? 0) ? 'all' : use
  const visible = rows.filter(
    (r) =>
      (activeType === 'all' || r.event_type === activeType) &&
      (activeUse === 'all' || kindBucket(r.property_type) === activeUse),
  )

  const mark = (id: string, status: 'seen' | 'dismissed') => {
    updateStatus.mutate(
      { ids: [id], status },
      { onError: () => toast.error('Could not update the event') },
    )
    if (status === 'dismissed') toast('Dismissed.')
  }

  const clearAll = () => {
    if (visible.length === 0) return
    const n = visible.length
    updateStatus.mutate(
      { ids: visible.map((r) => r.id!), status: 'seen' },
      {
        onSuccess: () => toast(`Cleared ${n} event${n > 1 ? 's' : ''} — find them under Market Monitor › Seen.`),
        onError: () => toast.error('Could not clear the events'),
      },
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 p-3 text-left hover:bg-accent/50"
      >
        {expanded ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
        <RadioTower className="size-4 text-primary" />
        <h2 className="text-sm font-medium">Market Monitor</h2>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
          {total}
        </span>
      </button>

      {expanded && (
        <div className="border-t">
          {/* View tabs + clear-all for the active slice */}
          <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/30 p-2">
            {VIEW_TABS.map((t) => (
              <Button
                key={t.value}
                size="sm"
                variant={view === t.value ? 'default' : 'outline'}
                className="h-7"
                onClick={() => setView(t.value)}
              >
                {t.label}
                {view === t.value && <span className="ml-1.5 tabular-nums opacity-70">{total}</span>}
              </Button>
            ))}
            <div className="ml-auto">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-muted-foreground"
                disabled={visible.length === 0 || updateStatus.isPending}
                onClick={clearAll}
                title="Mark every event in this slice as seen"
              >
                <Check className="size-3.5" />
                Clear all
              </Button>
            </div>
          </div>

          {/* Category + use slicers */}
          {rows.length > 0 && (
            <div className="space-y-1.5 border-b p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip active={activeType === 'all'} onClick={() => setType('all')}>
                  All types
                  <span className="ml-1.5 tabular-nums opacity-70">{total}</span>
                </Chip>
                {EVENT_TYPE_ORDER.filter((t) => (data?.byType[t] ?? 0) > 0).map((t) => (
                  <Chip
                    key={t}
                    active={activeType === t}
                    onClick={() => setType(t)}
                    className={activeType === t ? undefined : EVENT_TYPE_CHIP[t]}
                  >
                    {EVENT_TYPE_LABELS[t]}
                    <span className="ml-1.5 tabular-nums opacity-70">{data?.byType[t]}</span>
                  </Chip>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip active={activeUse === 'all'} onClick={() => setUse('all')}>
                  All uses
                </Chip>
                {USE_ORDER.filter((u) => (data?.byUse[u] ?? 0) > 0).map((u) => (
                  <Chip key={u} active={activeUse === u} onClick={() => setUse(u)}>
                    {USE_LABELS[u]}
                    <span className="ml-1.5 tabular-nums opacity-70">{data?.byUse[u]}</span>
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {visible.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">
              {view === 'verified'
                ? 'No new events on a property with a verified contact — try In the book.'
                : 'Nothing in this slice.'}
            </p>
          ) : (
            <>
              <ul className="divide-y">
                {visible.slice(0, MAX_ROWS).map((ev) => {
                  const label = ev.address
                    ? `${ev.address}${ev.city ? `, ${ev.city}` : ''}`
                    : ev.title ?? 'Market event'
                  const use = usageTag(ev.dor_use_code, ev.property_type)
                  const meta = [
                    marketSourceLabel(ev.source ?? ''),
                    ev.first_seen_at ? `${formatDistanceToNow(new Date(ev.first_seen_at))} ago` : null,
                  ].filter(Boolean)
                  return (
                    <li key={ev.id} className="flex items-start gap-2 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {ev.event_type && (
                            <span
                              className={cn(
                                'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4',
                                EVENT_TYPE_CHIP[ev.event_type],
                              )}
                            >
                              {EVENT_TYPE_LABELS[ev.event_type]}
                            </span>
                          )}
                          {use && (
                            <span className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-[11px] leading-4 text-muted-foreground">
                              {use}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                          {ev.property_id ? (
                            <Link
                              to={`/properties/${ev.property_id}`}
                              className="truncate text-sm font-medium hover:text-primary hover:underline"
                            >
                              {label}
                            </Link>
                          ) : (
                            <span className="truncate text-sm font-medium">{label}</span>
                          )}
                          {ev.url && (
                            <a
                              href={ev.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-muted-foreground hover:text-primary"
                              title="Open the source record"
                            >
                              <ExternalLink className="size-3.5" />
                            </a>
                          )}
                        </div>
                        {ev.address && ev.title && (
                          <div className="truncate text-xs text-muted-foreground">{ev.title}</div>
                        )}
                        <div className="truncate text-xs text-muted-foreground">{meta.join(' · ')}</div>
                        {view === 'verified' && (ev.owner_name || ev.best_contact_name || ev.best_contact_phone) && (
                          <div className="mt-0.5 truncate text-xs">
                            {ev.owner_name && <span className="text-muted-foreground">{ev.owner_name}</span>}
                            {ev.best_contact_name && (
                              <span className="font-medium">
                                {ev.owner_name ? ' · ' : ''}
                                {ev.best_contact_name}
                              </span>
                            )}
                            {ev.best_contact_phone && (
                              <span className="text-muted-foreground"> · {formatPhone(ev.best_contact_phone)}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <Button
                        size="icon"
                        variant="outline"
                        className={cn('size-7 shrink-0 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700')}
                        title="Mark seen"
                        onClick={() => mark(ev.id!, 'seen')}
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-7 shrink-0 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                        title="Dismiss"
                        onClick={() => mark(ev.id!, 'dismissed')}
                      >
                        <X className="size-4" />
                      </Button>
                    </li>
                  )
                })}
              </ul>
              {visible.length > MAX_ROWS && (
                <Link
                  to="/market-monitor"
                  className="block border-t p-2 text-center text-xs text-muted-foreground hover:text-primary"
                >
                  +{visible.length - MAX_ROWS} more — open Market Monitor
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Chip({
  active,
  onClick,
  className,
  children,
}: {
  active: boolean
  onClick: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent',
        className,
      )}
    >
      {children}
    </button>
  )
}
