import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Flame, Plus, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PropertyPreview } from '@/components/property-preview'
import { AddToClientDialog, type AddToClientProperty } from '@/components/add-to-client-dialog'
import { propertyKindLabels } from '@/components/property-form-dialog'
import {
  bestDiscount,
  usePendingDealFlags,
  useDismissDealFlags,
  useRestoreDealFlags,
  useScanDealFlags,
  PENDING_DEAL_FLAGS_CAP,
} from '@/hooks/use-deal-flags'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { useCurrentAsking } from '@/hooks/use-comps'
import { formatCurrency, formatPsf, formatSf } from '@/lib/format'

const INDUSTRIAL_FEED_KINDS = new Set(['industrial', 'land', 'other'])

/**
 * Below-market listings flagged by the sweep (asking <= 85% of the county median —
 * the same good-deal rule as the property-page market position card). Each row can be
 * pushed to a client's board or dismissed (dismissed properties are never re-flagged).
 * Same industrial-first lens as the New-listings feed, since LoopNet pads county
 * searches with retail/office.
 */
export function DealFlagsWidget() {
  const { data: flags = [] } = usePendingDealFlags()
  const dismiss = useDismissDealFlags()
  const restore = useRestoreDealFlags()
  const scan = useScanDealFlags()
  const [typeFilter, setTypeFilter] = usePersistentState<'industrial' | 'all'>(
    'deal-flags:type-filter',
    'industrial',
  )
  const [expanded, setExpanded] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [adding, setAdding] = useState<AddToClientProperty | null>(null)

  const visible = useMemo(() => {
    const filtered =
      typeFilter === 'all'
        ? flags
        : flags.filter(
            (f) => f.property?.property_type == null || INDUSTRIAL_FEED_KINDS.has(f.property.property_type),
          )
    // Strongest discount first — the whole point is "look at this one".
    return [...filtered].sort(
      (a, b) => (bestDiscount(a)?.pct ?? 0) - (bestDiscount(b)?.pct ?? 0),
    )
  }, [flags, typeFilter])

  const { data: askingMap } = useCurrentAsking(
    visible.map((f) => f.property?.id).filter((x): x is string => !!x),
  )

  const handleDismiss = (ids: string[]) =>
    dismiss.mutate(ids, {
      onSuccess: () =>
        toast.success(`Dismissed ${ids.length === 1 ? 'deal flag' : `${ids.length} deal flags`}`, {
          action: { label: 'Undo', onClick: () => restore.mutate(ids) },
        }),
      onError: () => toast.error('Could not dismiss'),
    })

  const handleScan = () =>
    scan.mutate(undefined, {
      onSuccess: (created) =>
        created > 0
          ? toast.success(`${created} new deal${created === 1 ? '' : 's'} flagged`)
          : toast.info('No new deals found'),
      onError: () => toast.error('Could not scan for deals'),
    })

  if (flags.length === 0 && typeFilter === 'all') return null

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
            <Flame className="size-4 text-amber-500" />
            <h2 className="text-sm font-medium">Flagged deals</h2>
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 tabular-nums">
              {visible.length}
            </span>
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={() => setTypeFilter(typeFilter === 'industrial' ? 'all' : 'industrial')}
            title="Below-market flags default to industrial, land, and other"
          >
            {typeFilter === 'industrial' ? `All types (${flags.length})` : 'Industrial only'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            disabled={scan.isPending}
            onClick={handleScan}
          >
            <RefreshCw className={`size-4 ${scan.isPending ? 'animate-spin' : ''}`} />
            Scan
          </Button>
        </div>
        {expanded && (
          <ul className="divide-y border-t">
            {visible.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                No pending deal flags — each sweep checks new listings against county medians.
              </li>
            )}
            {visible.map((f) => {
              const p = f.property!
              const best = bestDiscount(f)
              const asking = askingMap?.get(p.id)
              const metrics = [
                formatPsf(asking?.rate),
                formatCurrency(asking?.price),
                formatSf(p.building_sf),
                p.land_acres != null ? `${p.land_acres} AC` : null,
                p.property_type ? propertyKindLabels[p.property_type] : null,
              ].filter(Boolean)
              return (
                <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
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
                      {best && (
                        <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 tabular-nums">
                          {Math.abs(best.pct)}% below market ({best.kind})
                        </span>
                      )}
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
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      onClick={() =>
                        setAdding({ id: p.id, address: p.address, city: p.city, state: p.state })
                      }
                    >
                      <Plus className="size-4" />
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDismiss([f.id])}>
                      <X className="size-4" />
                      Dismiss
                    </Button>
                  </div>
                </li>
              )
            })}
            {flags.length >= PENDING_DEAL_FLAGS_CAP && (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                Showing the newest {PENDING_DEAL_FLAGS_CAP} — dismiss to surface older ones.
              </li>
            )}
          </ul>
        )}
      </div>
      <PropertyPreview
        propertyId={previewId}
        open={!!previewId}
        onOpenChange={(o) => !o && setPreviewId(null)}
      />
      <AddToClientDialog
        property={adding}
        open={!!adding}
        onOpenChange={(o) => !o && setAdding(null)}
      />
    </>
  )
}
