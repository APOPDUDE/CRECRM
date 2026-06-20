import { useState } from 'react'
import { CircleSlash, ExternalLink } from 'lucide-react'
import { PropertyPreview } from '@/components/property-preview'
import { useRecentlyOffMarket } from '@/hooks/use-dashboard'
import { formatCurrency, formatPsf, formatSf } from '@/lib/format'

/**
 * Properties the weekly sweep diff flipped to off_market (present in the prior sweep,
 * absent from the latest one). Informational — hidden entirely when nothing is off-market.
 */
export function OffMarketWidget() {
  const { data: items = [] } = useRecentlyOffMarket()
  const [previewId, setPreviewId] = useState<string | null>(null)

  if (items.length === 0) return null

  return (
    <>
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b p-3">
          <CircleSlash className="size-4 text-amber-600" />
          <h2 className="text-sm font-medium">Recently off-market</h2>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 tabular-nums">
            {items.length}
          </span>
        </div>
        <ul className="divide-y">
          {items.map((p) => {
            const metrics = [
              formatPsf(p.asking_rate_psf),
              formatCurrency(p.asking_price),
              formatSf(p.building_sf),
              p.property_type,
            ].filter(Boolean)
            return (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPreviewId(p.id)}
                      className="truncate text-left text-sm font-medium hover:underline"
                      title="See overview"
                    >
                      {p.address}
                    </button>
                    {p.listing_url && (
                      <a
                        href={p.listing_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-muted-foreground hover:text-primary"
                        title="View listing"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[p.city, p.state].filter(Boolean).join(', ')}
                    {metrics.length > 0 ? ` · ${metrics.join(' · ')}` : ''}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
      <PropertyPreview
        propertyId={previewId}
        open={!!previewId}
        onOpenChange={(o) => !o && setPreviewId(null)}
      />
    </>
  )
}
