import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, ExternalLink, Store, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  useFacebookTriage,
  useReviewDealRadar,
  useUpdateDealRadarStatus,
  type DealRadarRow,
} from '@/hooks/use-deal-radar'
import {
  formatRadarPrice,
  INTENT_ORDER,
  intentBadgeClass,
  intentLabels,
  typeLabels,
} from '@/lib/deal-radar'
import { cn } from '@/lib/utils'

/**
 * Dashboard triage of new Facebook listings, grouped sale / lease / ?. Quick keep
 * (✓ → stamps reviewed_at, stays a live radar row) or dismiss (✗ → dead), or click
 * the title to open it on Facebook. Hidden when the queue is empty.
 */
export function FacebookListingsWidget() {
  const { data } = useFacebookTriage()
  const review = useReviewDealRadar()
  const setStatus = useUpdateDealRadarStatus()
  const [expanded, setExpanded] = useState(false)

  const total = data?.total ?? 0
  if (total === 0) return null

  const keep = (row: DealRadarRow) => review.mutate(row.id)
  const dismiss = (row: DealRadarRow) => {
    setStatus.mutate({ id: row.id, status: 'dead' })
    toast('Dismissed.')
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
        <Store className="size-4 text-primary" />
        <h2 className="text-sm font-medium">Facebook listings</h2>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
          {total}
        </span>
      </button>
      {expanded && (
        <div className="border-t">
          {INTENT_ORDER.map((intent) => {
            const rows = data?.groups[intent] ?? []
            if (rows.length === 0) return null
            return (
              <div key={intent}>
                <div className="flex items-center gap-2 bg-muted/40 px-3 py-1.5">
                  <span
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-[11px] font-medium',
                      intentBadgeClass[intent],
                    )}
                  >
                    {intentLabels[intent]}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">{rows.length}</span>
                </div>
                <ul className="divide-y">
                  {rows.map((r) => (
                    <li key={r.id} className="flex items-start gap-2 p-3">
                      <div className="min-w-0 flex-1">
                        <a
                          href={r.listing_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sm font-medium hover:text-primary hover:underline"
                          title="Open on Facebook"
                        >
                          <span className="truncate">{r.title}</span>
                          <ExternalLink className="size-3 shrink-0 opacity-60" />
                        </a>
                        <div className="truncate text-xs text-muted-foreground">
                          {[typeLabels[r.listing_type], formatRadarPrice(r), r.location_text]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-7 shrink-0 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                        title="Keep"
                        onClick={() => keep(r)}
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-7 shrink-0 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                        title="Dismiss"
                        onClick={() => dismiss(r)}
                      >
                        <X className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
