import { Check, ExternalLink, RadioTower } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  useMarketEventAlerts,
  useUpdateMarketEventStatus,
} from '@/hooks/use-market-events'
import { formatPhone } from '@/lib/format'

/**
 * The market-monitor popup: a NEW permit/sale/zoning event landed on a property
 * whose owner has a VERIFIED contact — someone Alex can call about it right now.
 * Rare on purpose (the rule joins market_events to property_owner_rollup's
 * owner_contact_verified in Postgres), so it renders loud, expanded, and only
 * when there is something to say. "Got it" marks the event seen and the row
 * leaves; the full feed stays on /market-monitor.
 */
export function MarketAlertsWidget() {
  const { data: alerts = [] } = useMarketEventAlerts()
  const updateStatus = useUpdateMarketEventStatus()

  if (alerts.length === 0) return null

  const markSeen = (id: string) =>
    updateStatus.mutate(
      { ids: [id], status: 'seen' },
      { onError: () => toast.error('Could not update the event') },
    )

  return (
    <div className="overflow-hidden rounded-lg border border-blue-500/40 bg-blue-500/5">
      <div className="flex items-center gap-2 border-b border-blue-500/20 p-3">
        <RadioTower className="size-4 text-blue-600" />
        <h2 className="text-sm font-medium">
          Market alert — activity on {alerts.length === 1 ? 'a property' : `${alerts.length} properties`} with a
          verified contact
        </h2>
        <Link to="/market-monitor" className="ml-auto text-xs text-muted-foreground hover:text-primary">
          Open Market Monitor
        </Link>
      </div>
      <ul className="divide-y">
        {alerts.map((a) => (
          <li key={a.event_id} className="flex flex-wrap items-start justify-between gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link
                  to={`/properties/${a.property_id}`}
                  className="text-sm font-medium hover:underline"
                >
                  {a.address ?? 'Property'}
                  {a.city ? `, ${a.city}` : ''}
                </Link>
                {a.url && (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-primary"
                    title="Open the source record"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
              <div className="text-xs text-muted-foreground">{a.title}</div>
              <div className="mt-0.5 text-xs">
                {a.owner_name && <span className="text-muted-foreground">{a.owner_name}</span>}
                {a.contact_name && (
                  <span className="font-medium">
                    {a.owner_name ? ' · ' : ''}
                    {a.contact_name}
                  </span>
                )}
                {a.contact_phone && (
                  <span className="text-muted-foreground"> · {formatPhone(a.contact_phone)}</span>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              disabled={updateStatus.isPending}
              onClick={() => markSeen(a.event_id)}
            >
              <Check className="size-4" />
              Got it
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
