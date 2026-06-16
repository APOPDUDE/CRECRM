import { useState } from 'react'
import { Check, ExternalLink, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PropertyPreview } from '@/components/property-preview'
import {
  usePendingSuggestions,
  useApproveSuggestion,
  useDismissSuggestion,
  type Suggestion,
} from '@/hooks/use-suggestions'
import { formatCurrency, formatPsf, formatSf } from '@/lib/format'

function tenantName(s: Suggestion): string {
  const tr = s.tenant_rep
  if (tr?.company?.name) return tr.company.name
  if (tr?.contact) {
    const n = [tr.contact.first_name, tr.contact.last_name].filter(Boolean).join(' ')
    if (n) return n
  }
  return 'a tenant'
}

/**
 * Daily-sweep property suggestions awaiting review. Each one can be added to the
 * tenant's board (creates an inquiring match) or dismissed — the broker decides
 * one by one instead of having them auto-dumped onto the board.
 */
export function SuggestionsWidget() {
  const { data: suggestions = [] } = usePendingSuggestions()
  const approve = useApproveSuggestion()
  const dismiss = useDismissSuggestion()
  const [previewId, setPreviewId] = useState<string | null>(null)

  if (suggestions.length === 0) return null

  const handleApprove = (s: Suggestion) =>
    approve.mutate(s.id, {
      onSuccess: () => toast.success(`Added to ${tenantName(s)}`),
      onError: () => toast.error('Could not add it'),
    })
  const handleDismiss = (s: Suggestion) =>
    dismiss.mutate(s.id, { onError: () => toast.error('Could not dismiss it') })

  return (
    <>
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b p-3">
        <Sparkles className="size-4 text-primary" />
        <h2 className="text-sm font-medium">New property suggestions</h2>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
          {suggestions.length}
        </span>
      </div>
      <ul className="divide-y">
        {suggestions.map((s) => {
          const p = s.property
          const url = p?.listing_url
          const metrics = [
            formatPsf(p?.asking_rate_psf),
            formatCurrency(p?.asking_price),
            formatSf(p?.building_sf),
            p?.property_type,
          ].filter(Boolean)
          const busy =
            (approve.isPending && approve.variables === s.id) ||
            (dismiss.isPending && dismiss.variables === s.id)
          return (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => p && setPreviewId(p.id)}
                    className="truncate text-left text-sm font-medium hover:underline"
                    title="See overview"
                  >
                    {p?.address ?? 'Property'}
                  </button>
                  {url && (
                    <a
                      href={url}
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
                  {[p?.city, p?.state].filter(Boolean).join(', ')}
                  {metrics.length > 0 ? ` · ${metrics.join(' · ')}` : ''}
                </div>
                <div className="mt-0.5 text-xs">
                  <span className="text-muted-foreground">For </span>
                  <span className="font-medium">{tenantName(s)}</span>
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" disabled={busy} onClick={() => handleApprove(s)}>
                  <Check className="size-4" />
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => handleDismiss(s)}
                >
                  <X className="size-4" />
                  Dismiss
                </Button>
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
