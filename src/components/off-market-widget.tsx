import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, CircleSlash, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { propertyKindLabels } from '@/components/property-form-dialog'
import { useRecentlyOffMarket, useClearOffMarket } from '@/hooks/use-dashboard'
import { useCurrentAsking } from '@/hooks/use-comps'
import { formatCurrency, formatPsf, formatSf } from '@/lib/format'

/**
 * Properties the weekly sweep flipped to off_market in the last 7 days. Collapsed to a
 * count; expand to see each, clicking through to its detail page. Hidden when empty.
 */
export function OffMarketWidget() {
  const navigate = useNavigate()
  const { data: items = [] } = useRecentlyOffMarket()
  const { data: askingMap } = useCurrentAsking(items.map((p) => p.id))
  const clearOffMarket = useClearOffMarket()
  const [expanded, setExpanded] = useState(false)

  if (items.length === 0) return null

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
          <CircleSlash className="size-4 text-amber-600" />
          <h2 className="text-sm font-medium">New off-market this week</h2>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 tabular-nums">
            {items.length}
          </span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          onClick={clearOffMarket}
          title="Mark all reviewed — clears the feed until the next sweep flips more"
        >
          Clear
        </Button>
      </div>
      {expanded && (
        <ul className="divide-y border-t">
          {items.map((p) => {
            const asking = askingMap?.get(p.id)
            const metrics = [
              formatPsf(asking?.rate),
              formatCurrency(asking?.price),
              formatSf(p.building_sf),
              p.property_type ? propertyKindLabels[p.property_type] : null,
            ].filter(Boolean)
            return (
              <li
                key={p.id}
                className="flex items-start justify-between gap-3 p-3 hover:bg-accent/50"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/properties/${p.id}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm font-medium">{p.address}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[p.city, p.state].filter(Boolean).join(', ')}
                    {metrics.length > 0 ? ` · ${metrics.join(' · ')}` : ''}
                  </div>
                </button>
                {p.listing_url && (
                  <a
                    href={p.listing_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
                    title="View listing"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

