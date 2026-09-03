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
  type MarketEventType,
} from '@/hooks/use-market-events'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { formatPhone } from '@/lib/format'
import { cn } from '@/lib/utils'

// Friendly category labels — probate rides the life_event type.
const TYPE_LABELS: Record<MarketEventType, string> = {
  permit: 'Permits',
  sale: 'Sales',
  zoning_change: 'Zoning',
  code_enforcement: 'Code enforcement',
  foreclosure: 'Foreclosure',
  life_event: 'Probate / life event',
  bankruptcy: 'Bankruptcy',
  tax_delinquent: 'Tax delinquent',
}

// Distress signals first, routine activity last.
const TYPE_ORDER: MarketEventType[] = [
  'foreclosure',
  'bankruptcy',
  'tax_delinquent',
  'code_enforcement',
  'life_event',
  'permit',
  'zoning_change',
  'sale',
]

const MAX_ROWS = 60

/**
 * Dashboard Market Monitor: new market events you haven't marked yet — permits,
 * sales, zoning, code enforcement, foreclosure, bankruptcy, probate. Toggle
 * "Verified" (only where you have a verified owner contact — actionable now) vs
 * "All", then slice by category. Mark each Seen (✓) or Dismiss (✗); either drops
 * it. Hidden only when there is nothing to review in All.
 */
export function MarketMonitorWidget() {
  const [verifiedOnly, setVerifiedOnly] = usePersistentState<boolean>('market-monitor:verified', true)
  const [type, setType] = usePersistentState<MarketEventType | 'all'>('market-monitor:type', 'all')
  const [expanded, setExpanded] = useState(false)
  const { data } = useMarketEventFeed(verifiedOnly)
  const updateStatus = useUpdateMarketEventStatus()

  const total = data?.total ?? 0
  // Hide only when even "All" is empty. When Verified is empty we still render so
  // the toggle is reachable.
  if (total === 0 && !verifiedOnly) return null

  const rows = data?.rows ?? []
  // If a persisted category has no rows in the current view (e.g. after flipping
  // Verified/All), fall back to All so the list is never mysteriously empty.
  const activeType: MarketEventType | 'all' =
    type !== 'all' && !(data?.byType[type] ?? 0) ? 'all' : type
  const visible = activeType === 'all' ? rows : rows.filter((r) => r.event_type === activeType)

  const mark = (id: string, status: 'seen' | 'dismissed') => {
    updateStatus.mutate(
      { ids: [id], status },
      { onError: () => toast.error('Could not update the event') },
    )
    if (status === 'dismissed') toast('Dismissed.')
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-2 p-3 text-left hover:bg-accent/50"
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
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0"
          onClick={() => setVerifiedOnly((v) => !v)}
          title="Toggle between verified-contact events and all market activity"
        >
          {verifiedOnly ? 'Verified' : 'All'}
        </Button>
      </div>

      {expanded && (
        <div className="border-t">
          {/* Category slicer */}
          <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/30 p-2">
            <Button
              size="sm"
              variant={activeType === 'all' ? 'default' : 'outline'}
              className="h-7"
              onClick={() => setType('all')}
            >
              All
              <span className="ml-1.5 tabular-nums opacity-70">{total}</span>
            </Button>
            {TYPE_ORDER.filter((t) => (data?.byType[t] ?? 0) > 0).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={activeType === t ? 'default' : 'outline'}
                className="h-7"
                onClick={() => setType(t)}
              >
                {TYPE_LABELS[t]}
                <span className="ml-1.5 tabular-nums opacity-70">{data?.byType[t]}</span>
              </Button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">
              {verifiedOnly
                ? 'No new events on a property with a verified contact — switch to All.'
                : 'Nothing in this category.'}
            </p>
          ) : (
            <>
              <ul className="divide-y">
                {visible.slice(0, MAX_ROWS).map((ev) => {
                  const label = ev.address
                    ? `${ev.address}${ev.city ? `, ${ev.city}` : ''}`
                    : ev.title ?? 'Market event'
                  const meta = [
                    ev.event_type ? TYPE_LABELS[ev.event_type] : null,
                    marketSourceLabel(ev.source ?? ''),
                    ev.first_seen_at ? `${formatDistanceToNow(new Date(ev.first_seen_at))} ago` : null,
                  ].filter(Boolean)
                  return (
                    <li key={ev.id} className="flex items-start gap-2 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
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
                        {verifiedOnly && (ev.owner_name || ev.best_contact_name || ev.best_contact_phone) && (
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
