import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Flame, Plus, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PropertyPreview } from '@/components/property-preview'
import { AddToClientDialog, type AddToClientProperty } from '@/components/add-to-client-dialog'
import { propertyKindLabels } from '@/lib/labels'
import {
  bestDiscount,
  landUse,
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
        : flags.filter((f) => {
            const p = f.property
            if (p?.property_type == null) return true
            if (!INDUSTRIAL_FEED_KINDS.has(p.property_type)) return false
            // Within land, hide the retail/residential/multifamily/etc. LoopNet mixes in
            // — it stays in the book and in the "all" view, just not in the deal scan.
            if (p.property_type === 'land') return !landUse(p)?.nonIndustrial
            return true
          })
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
      onSuccess: (queued) =>
        queued > 0
          ? toast.success(
              `Scan started — ${queued.toLocaleString('en-US')} listing${queued === 1 ? '' : 's'} queued. Flags update in a few minutes.`,
            )
          : toast.info('Nothing new to scan'),
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
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            disabled={visible.length === 0}
            onClick={() => handleDismiss(visible.map((f) => f.id))}
            title="Dismiss everything shown (the toast can undo it)"
          >
            Clear
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
              // For land, the use chip (below) carries the type; drop the redundant "Land".
              const use = landUse(p)
              const metrics = [
                formatPsf(asking?.rate),
                formatCurrency(asking?.price),
                formatSf(asking?.sf ?? p.gross_sf),
                p.land_acres != null ? `${p.land_acres} AC` : null,
                p.property_type && p.property_type !== 'land' ? propertyKindLabels[p.property_type] : null,
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
                      {/* Land use — green reads as "worth a look" (industrial/ambiguous),
                          gray as "skip" (retail/residential/etc.). Only shown for land. */}
                      {use && (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                            use.nonIndustrial
                              ? 'bg-gray-500/10 text-gray-500'
                              : 'bg-emerald-500/10 text-emerald-600'
                          }`}
                          title={
                            use.nonIndustrial
                              ? 'Non-industrial land — hidden from the industrial filter'
                              : 'Industrial or unclassified land'
                          }
                        >
                          {use.label}
                        </span>
                      )}
                      {asking?.listing_url && (
                        <a
                          href={asking.listing_url}
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
