import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PropertyPreview } from '@/components/property-preview'
import { propertyKindLabels } from '@/components/property-form-dialog'
import {
  clientLabel,
  scoreSuggestion,
  useApproveSuggestion,
  useDismissSuggestions,
  usePendingSuggestions,
  useRefreshSuggestions,
  useRestoreSuggestions,
  PENDING_SUGGESTIONS_CAP,
  type Suggestion,
  type SuggestionClient,
} from '@/hooks/use-suggestions'
import { useCurrentAsking } from '@/hooks/use-comps'
import { formatCurrency, formatPsf, formatSf } from '@/lib/format'

const TOP_PER_CLIENT = 5

type ClientGroup = {
  client: SuggestionClient
  suggestions: Suggestion[] // sorted best-first
}

/** "Industrial · 20,000–100,000 SF · East Tampa · sale" — the client's ask, at a glance. */
function requirementSummary(c: SuggestionClient): string {
  const sfBand =
    c.building_sf_min != null || c.building_sf_max != null
      ? [c.building_sf_min?.toLocaleString('en-US'), c.building_sf_max?.toLocaleString('en-US')]
          .filter(Boolean)
          .join('–') + ' SF'
      : null
  return [
    c.property_type ? propertyKindLabels[c.property_type] : null,
    sfBand,
    c.target_markets,
    c.deal_type,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Match suggestions from the weekly sweep, grouped per searching client and ranked
 * (SF fit, market specificity, type match, recency). Accept creates the inquiring
 * pursuit on that client's board; Dismiss remembers the pair so the sweep never
 * re-suggests it. "Find new matches" cross-references the last two weeks on demand.
 */
export function SuggestionsWidget() {
  const { data: suggestions = [] } = usePendingSuggestions()
  const approve = useApproveSuggestion()
  const dismiss = useDismissSuggestions()
  const restore = useRestoreSuggestions()
  const refresh = useRefreshSuggestions()
  const { data: askingMap } = useCurrentAsking(
    suggestions.map((s) => s.property?.id).filter((x): x is string => !!x),
  )
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set())
  const [showAllClients, setShowAllClients] = useState<Set<string>>(new Set())
  const [previewId, setPreviewId] = useState<string | null>(null)

  const groups = useMemo<ClientGroup[]>(() => {
    const score = (s: Suggestion) => scoreSuggestion(s, askingMap?.get(s.property?.id ?? ''))
    const byClient = new Map<string, ClientGroup>()
    for (const s of suggestions) {
      if (!s.client || !s.property) continue
      const g = byClient.get(s.client.id) ?? { client: s.client, suggestions: [] }
      g.suggestions.push(s)
      byClient.set(s.client.id, g)
    }
    for (const g of byClient.values()) {
      g.suggestions.sort((a, b) => score(b) - score(a))
    }
    return [...byClient.values()].sort(
      (a, b) => score(b.suggestions[0]) - score(a.suggestions[0]),
    )
  }, [suggestions, askingMap])

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  const handleAccept = (s: Suggestion) =>
    approve.mutate(
      { id: s.id },
      {
        onSuccess: () => toast.success(`Added to ${clientLabel(s.client)}'s board`),
        onError: () => toast.error('Could not add it'),
      },
    )

  // Dismissed pairs are never re-suggested, so every dismiss toast carries an Undo.
  const handleDismiss = (ids: string[]) =>
    dismiss.mutate(ids, {
      onSuccess: () =>
        toast.success(`Dismissed ${ids.length === 1 ? 'suggestion' : `${ids.length} suggestions`}`, {
          action: { label: 'Undo', onClick: () => restore.mutate(ids) },
        }),
      onError: () => toast.error('Could not dismiss'),
    })

  const handleRefresh = () =>
    refresh.mutate(undefined, {
      onSuccess: (created) =>
        created > 0
          ? toast.success(`${created} new suggestion${created === 1 ? '' : 's'}`)
          : toast.info('No new matches found'),
      onError: () => toast.error('Could not refresh suggestions'),
    })

  return (
    <>
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center gap-2 p-3">
          <Sparkles className="size-4 text-primary" />
          <h2 className="text-sm font-medium">Suggested matches</h2>
          {suggestions.length > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
              {suggestions.length}
            </span>
          )}
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            disabled={refresh.isPending}
            onClick={handleRefresh}
          >
            <RefreshCw className={`size-4 ${refresh.isPending ? 'animate-spin' : ''}`} />
            Find new matches
          </Button>
        </div>
        {suggestions.length === 0 ? (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            No pending suggestions — new listings are matched against searching clients each
            sweep, or on demand.
          </p>
        ) : (
          <div className="divide-y border-t">
            {groups.map((g) => {
              const cid = g.client.id
              const expanded = expandedClients.has(cid)
              const showAll = showAllClients.has(cid)
              const visible = showAll ? g.suggestions : g.suggestions.slice(0, TOP_PER_CLIENT)
              const summary = requirementSummary(g.client)
              return (
                <div key={cid}>
                  <div className="flex items-center gap-1 pr-2">
                    <button
                      type="button"
                      onClick={() => setExpandedClients((s) => toggle(s, cid))}
                      className="flex min-w-0 flex-1 items-center gap-2 p-3 text-left hover:bg-accent/50"
                    >
                      {expanded ? (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-sm font-medium">
                        {clientLabel(g.client)}
                      </span>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
                        {g.suggestions.length}
                      </span>
                      {summary && (
                        <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                          {summary}
                        </span>
                      )}
                    </button>
                    {expanded && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-muted-foreground"
                        disabled={dismiss.isPending}
                        onClick={() => handleDismiss(g.suggestions.map((s) => s.id))}
                      >
                        Dismiss all
                      </Button>
                    )}
                  </div>
                  {expanded && (
                    <ul className="divide-y border-t bg-accent/20">
                      {visible.map((s) => {
                        const p = s.property!
                        const asking = askingMap?.get(p.id)
                        const availSf =
                          asking?.sf != null && asking.sf !== p.building_sf
                            ? `${formatSf(asking.sf)} avail`
                            : null
                        const metrics = [
                          formatPsf(asking?.rate),
                          formatCurrency(asking?.price),
                          availSf ?? formatSf(p.building_sf),
                          p.land_acres != null ? `${p.land_acres} AC` : null,
                          p.property_type ? propertyKindLabels[p.property_type] : null,
                        ].filter(Boolean)
                        return (
                          <li
                            key={s.id}
                            className="flex flex-wrap items-start justify-between gap-3 p-3 pl-9"
                          >
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
                            <div className="flex shrink-0 gap-1.5">
                              <Button size="sm" onClick={() => handleAccept(s)}>
                                <Check className="size-4" />
                                Accept
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDismiss([s.id])}
                              >
                                <X className="size-4" />
                                Dismiss
                              </Button>
                            </div>
                          </li>
                        )
                      })}
                      {g.suggestions.length > TOP_PER_CLIENT && (
                        <li className="px-3 py-2 pl-9">
                          <button
                            type="button"
                            onClick={() => setShowAllClients((s) => toggle(s, cid))}
                            className="text-xs text-primary hover:underline"
                          >
                            {showAll
                              ? 'Show top matches only'
                              : `Show all ${g.suggestions.length}`}
                          </button>
                        </li>
                      )}
                      <li className="px-3 py-2 pl-9 text-xs text-muted-foreground">
                        <Link to={`/tenant-rep/${cid}`} className="hover:underline">
                          Open {clientLabel(g.client)}&apos;s board →
                        </Link>
                      </li>
                    </ul>
                  )}
                </div>
              )
            })}
            {suggestions.length >= PENDING_SUGGESTIONS_CAP && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Showing the newest {PENDING_SUGGESTIONS_CAP} — accept or dismiss to surface older
                ones.
              </p>
            )}
          </div>
        )}
      </div>
      <PropertyPreview
        propertyId={previewId}
        open={!!previewId}
        onOpenChange={(o) => !o && setPreviewId(null)}
      />
    </>
  )
}
