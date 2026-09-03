import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, ExternalLink, Store, X } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  useDeclineFacebookIntent,
  useFacebookTriage,
  useUpdateDealRadarStatus,
  type DealRadarIntent,
  type DealRadarRow,
} from '@/hooks/use-deal-radar'
import { formatRadarPrice, INTENT_ORDER, intentLabels, typeLabels } from '@/lib/deal-radar'
import { cn } from '@/lib/utils'

/**
 * Dashboard triage of new Facebook listings. One tab per intent (For sale / For
 * lease / ?), each showing that bucket's listings with the date they were scraped.
 * Approve (✓ → Approved bucket, where you turn it into a deal) or decline (✗ →
 * Declined) each; a per-tab "Decline all" clears the rest of the bucket. Both land
 * on the Deal Radar page's Approved / Declined tabs. Hidden when the queue is empty.
 */
export function FacebookListingsWidget() {
  const { data } = useFacebookTriage()
  const declineIntent = useDeclineFacebookIntent()
  const setStatus = useUpdateDealRadarStatus()
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<DealRadarIntent>('sale')

  const total = data?.total ?? 0
  if (total === 0) return null

  const groups = data?.groups ?? { sale: [], lease: [], unknown: [] }
  const rows = groups[tab] ?? []

  const approve = (row: DealRadarRow) => {
    setStatus.mutate({ id: row.id, status: 'approved' })
    toast('Approved — find it under Deal Radar › Approved.')
  }
  const decline = (row: DealRadarRow) => {
    setStatus.mutate({ id: row.id, status: 'declined' })
    toast('Declined.')
  }
  const declineAll = () => {
    if (rows.length === 0) return
    declineIntent.mutate(tab)
    toast(`Declined ${rows.length} ${intentLabels[tab]} listing${rows.length > 1 ? 's' : ''}.`)
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
          {/* Intent tabs + clear-all for the active tab */}
          <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/30 p-2">
            {INTENT_ORDER.map((i) => (
              <Button
                key={i}
                size="sm"
                variant={tab === i ? 'default' : 'outline'}
                className="h-7"
                onClick={() => setTab(i)}
              >
                {intentLabels[i]}
                <span className="ml-1.5 tabular-nums opacity-70">{groups[i]?.length ?? 0}</span>
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 text-xs text-muted-foreground"
              disabled={rows.length === 0 || declineIntent.isPending}
              onClick={declineAll}
            >
              Decline all
            </Button>
          </div>

          {rows.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">
              Nothing in {intentLabels[tab]}.
            </p>
          ) : (
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
                      {[
                        typeLabels[r.listing_type],
                        formatRadarPrice(r),
                        r.location_text,
                        r.found_at ? `Scraped ${format(new Date(r.found_at), 'MMM d')}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="outline"
                    className={cn('size-7 shrink-0 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700')}
                    title="Approve"
                    onClick={() => approve(r)}
                  >
                    <Check className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-7 shrink-0 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                    title="Decline"
                    onClick={() => decline(r)}
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
