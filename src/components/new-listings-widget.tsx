import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Plus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddToClientDialog, type AddToClientProperty } from '@/components/add-to-client-dialog'
import { propertyKindLabels } from '@/components/property-form-dialog'
import {
  useNewListings,
  useClearNewListings,
  type NewListingsTypeFilter,
} from '@/hooks/use-dashboard'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { useCurrentAsking } from '@/hooks/use-comps'
import { formatCurrency, formatPsf, formatSf } from '@/lib/format'

/**
 * Weekly feed of newly-scraped listings (last 7 days). Collapsed to a count; expand to
 * review each and add it to a client's board. Defaults to industrial/land/other — the
 * sweep imports every type for county market intel, but LoopNet's deep pagination pads
 * in retail/office noise; the toggle shows everything. Hidden when there's nothing new.
 */
export function NewListingsWidget() {
  const [filter, setFilter] = usePersistentState<NewListingsTypeFilter>(
    'new-listings:type-filter',
    'industrial',
  )
  const { data } = useNewListings(filter)
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const allTotal = data?.allTotal ?? 0
  const { data: askingMap } = useCurrentAsking(items.map((p) => p.id))
  const clearNewListings = useClearNewListings()
  const [expanded, setExpanded] = useState(false)
  const [adding, setAdding] = useState<AddToClientProperty | null>(null)

  if (allTotal === 0) return null

  return (
    <>
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
            <Sparkles className="size-4 text-primary" />
            <h2 className="text-sm font-medium">New listings this week</h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
              {total}
            </span>
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={() => setFilter(filter === 'industrial' ? 'all' : 'industrial')}
            title="The sweep imports every property type for market intel; this widget defaults to industrial, land, and other"
          >
            {filter === 'industrial' ? `All types (${allTotal})` : 'Industrial only'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={clearNewListings}
            title="Mark all reviewed — clears the count until the next sweep"
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
                p.land_acres != null ? `${p.land_acres} AC` : null,
                p.property_type ? propertyKindLabels[p.property_type] : null,
              ].filter(Boolean)
              return (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{p.address}</span>
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
                  <Button
                    size="sm"
                    onClick={() =>
                      setAdding({ id: p.id, address: p.address, city: p.city, state: p.state })
                    }
                  >
                    <Plus className="size-4" />
                    Add
                  </Button>
                </li>
              )
            })}
            {total > items.length && (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                Showing the {items.length} most recent of {total}.
              </li>
            )}
          </ul>
        )}
      </div>
      <AddToClientDialog
        property={adding}
        open={!!adding}
        onOpenChange={(o) => !o && setAdding(null)}
      />
    </>
  )
}
