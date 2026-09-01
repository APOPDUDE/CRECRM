import { AlertTriangle, ExternalLink, Gavel, HardHat, Landmark, Tag } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { marketSourceLabel, usePropertyMarketEvents, type MarketEventType } from '@/hooks/use-market-events'

const TYPE_META: Record<MarketEventType, { label: string; icon: typeof HardHat }> = {
  permit: { label: 'Permit', icon: HardHat },
  sale: { label: 'Sale', icon: Tag },
  zoning_change: { label: 'Zoning', icon: Landmark },
  code_enforcement: { label: 'Code enforcement', icon: AlertTriangle },
  foreclosure: { label: 'Pre-foreclosure', icon: Gavel },
}

function detailStr(detail: unknown, key: string): string | null {
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const v = (detail as Record<string, unknown>)[key]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return null
}

/**
 * Everything the market monitor has ever seen happen to this property —
 * permits now, sales and zoning changes when those sources land. Read-only
 * history (triage lives on /market-monitor); each row links to the source
 * record. Renders nothing while the property has no events.
 */
export function PropertyHistory({ propertyId }: { propertyId: string }) {
  const { data: events = [] } = usePropertyMarketEvents(propertyId)

  if (events.length === 0) return null

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Property history</h2>
      <ul className="divide-y rounded-lg border bg-card">
        {events.map((e) => {
          const TypeIcon = TYPE_META[e.event_type].icon
          const description = detailStr(e.detail, 'description')
          const status = detailStr(e.detail, 'status')
          return (
            <li key={e.id} className="flex items-start gap-3 p-3">
              <TypeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-sm">{e.title}</div>
                {description && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{description}</p>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {e.event_date && <span>{e.event_date}</span>}
                  <span>· {marketSourceLabel(e.source)}</span>
                  {status && <span>· {status}</span>}
                  <span>· spotted {formatDistanceToNow(new Date(e.first_seen_at))} ago</span>
                </div>
              </div>
              {e.url && (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-primary"
                  title="Open the source record"
                >
                  <ExternalLink className="size-4" />
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
