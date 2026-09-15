import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ExternalLink,
  Link2,
  MapPin,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useListingQueue,
  useReviewListing,
  type MatchState,
  type QueueListing,
  type ReviewStatus,
} from '@/hooks/use-listing-queue'
import { usePropertySearch } from '@/hooks/use-listing-parcels'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { formatCurrency, formatPsf, formatSf } from '@/lib/format'
import { formatDate } from '@/lib/dates'
import { propertyKindLabels } from '@/lib/labels'
import { cn } from '@/lib/utils'

const PAGE = 50

/** Industrial-first, the way the old widget defaulted — LoopNet pads searches with retail. */
const INDUSTRIAL_KINDS = ['industrial', 'land', 'other']

const matchMeta: Record<MatchState, { label: string; cls: string; icon: typeof AlertTriangle }> = {
  matched: {
    label: 'Matched',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: CheckCircle2,
  },
  partial: {
    label: 'No parcel',
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
    icon: AlertTriangle,
  },
  unmatched: {
    label: 'No match',
    cls: 'bg-rose-50 text-rose-700 border-rose-200',
    icon: AlertTriangle,
  },
}

function MatchBadge({ state }: { state: MatchState }) {
  const m = matchMeta[state]
  const Icon = m.icon
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        m.cls,
      )}
      title={
        state === 'matched'
          ? 'Resolved to a parcel in the book'
          : state === 'partial'
            ? 'Mappable, but no parcel identity'
            : 'No parcel and no coordinates — this cannot appear on the map'
      }
    >
      <Icon className="size-3" />
      {m.label}
    </span>
  )
}

/** Bind a ghost listing onto a real property in the book. */
function AttachDialog({
  listing,
  onClose,
}: {
  listing: QueueListing | null
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 250)
  const { data: results = [], isFetching } = usePropertySearch(debounced)
  const review = useReviewListing()

  return (
    <Dialog open={!!listing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach to a property</DialogTitle>
        </DialogHeader>
        {listing && (
          <>
            <p className="text-sm text-muted-foreground">
              Bind <span className="font-medium text-foreground">{listing.address}</span> onto the
              property it really belongs to.
            </p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-8"
                placeholder="Address, city, parcel or folio…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {isFetching && results.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">Searching…</p>
              )}
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="w-full rounded-md border p-2 text-left text-sm hover:bg-accent"
                  onClick={() =>
                    review.mutate(
                      { propertyId: listing.property_id, status: 'attached', attachTo: r.id },
                      {
                        onSuccess: () => {
                          toast.success(`Attached to ${r.address}`)
                          onClose()
                        },
                      },
                    )
                  }
                >
                  <div className="font-medium">{r.address}</div>
                  <div className="text-xs text-muted-foreground">
                    {[r.city, r.county, r.parcel_number].filter(Boolean).join(' · ')}
                  </div>
                </button>
              ))}
              {debounced.length >= 2 && !isFetching && results.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">No property matches that.</p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ListingRow({
  l,
  onAttach,
}: {
  l: QueueListing
  onAttach: (l: QueueListing) => void
}) {
  const review = useReviewListing()
  const price =
    l.asking_deal_type === 'sale'
      ? formatCurrency(l.sale_price)
      : formatPsf(l.asking_lease_rate_psf)

  return (
    <div className="flex flex-wrap items-start gap-3 border-b p-3 last:border-b-0 hover:bg-accent/40">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {l.match_state === 'matched' ? (
            <Link
              to={`/properties/${l.property_id}`}
              className="truncate font-medium hover:underline"
            >
              {l.address}
            </Link>
          ) : (
            <span className="truncate font-medium">{l.address}</span>
          )}
          <MatchBadge state={l.match_state} />
          {l.property_type && (
            <Badge variant="secondary">{propertyKindLabels[l.property_type]}</Badge>
          )}
        </div>

        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
          {[l.city, l.county].filter(Boolean).length > 0 && (
            <span>{[l.city, l.county].filter(Boolean).join(' · ')}</span>
          )}
          {l.gross_sf != null && <span>{formatSf(l.gross_sf)}</span>}
          {l.land_acres != null && <span>{l.land_acres} ac</span>}
          {price && <span className="font-medium text-foreground">{price}</span>}
          {l.cap_rate_pct != null && <span>{l.cap_rate_pct}% cap</span>}
          {l.also_listed_other_side && (
            <span title="Listed for both lease and sale">also {l.asking_deal_type === 'sale' ? 'for lease' : 'for sale'}</span>
          )}
          <span>Seen {formatDate(l.first_seen)}</span>
        </div>

        {l.broker_company && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {[l.broker_name, l.broker_company].filter(Boolean).join(' · ')}
          </div>
        )}
        {l.attached_address && (
          <div className="mt-1 flex items-center gap-1 text-xs text-blue-700">
            <Link2 className="size-3" /> Attached to {l.attached_address}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap gap-1.5">
        {l.listing_url && (
          <Button size="sm" variant="outline" asChild>
            <a href={l.listing_url} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1 size-3.5" /> Listing
            </a>
          </Button>
        )}
        {l.match_state !== 'matched' && l.review_status !== 'attached' && (
          <Button size="sm" variant="outline" onClick={() => onAttach(l)}>
            <Link2 className="mr-1 size-3.5" /> Attach
          </Button>
        )}
        {l.review_status === 'new' ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              review.mutate({ propertyId: l.property_id, status: 'dismissed' })
            }
          >
            <Trash2 className="mr-1 size-3.5" /> Dismiss
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => review.mutate({ propertyId: l.property_id, status: 'new' })}
          >
            <Undo2 className="mr-1 size-3.5" /> Undo
          </Button>
        )}
      </div>
    </div>
  )
}

export function ListingQueuePage() {
  const [status, setStatus] = usePersistentState<ReviewStatus>('listing-queue:status', 'new')
  const [match, setMatch] = usePersistentState<MatchState | 'all'>('listing-queue:match', 'all')
  const [industrialOnly, setIndustrialOnly] = usePersistentState(
    'listing-queue:industrial',
    true,
  )
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [attaching, setAttaching] = useState<QueueListing | null>(null)
  const debounced = useDebouncedValue(search, 300)

  const { data, isLoading } = useListingQueue({
    status,
    match: match === 'all' ? null : match,
    types: industrialOnly ? INDUSTRIAL_KINDS : null,
    search: debounced,
    limit: PAGE,
    offset: page * PAGE,
  })

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const c = data?.counts ?? {}

  const tabs: { key: MatchState | 'all'; label: string; n?: number }[] = [
    { key: 'all', label: 'All', n: c.new_total },
    { key: 'unmatched', label: 'No match', n: c.unmatched },
    { key: 'partial', label: 'No parcel', n: c.partial },
    { key: 'matched', label: 'Matched', n: c.matched },
  ]

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">New listings</h1>
          <p className="text-sm text-muted-foreground">
            Every scraped listing, matched or not. Attach the ones worth keeping, dismiss the
            rest — the queue remembers, so nothing ages out.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border p-1">
          {(['new', 'dismissed', 'attached'] as ReviewStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setStatus(s)
                setPage(0)
              }}
              className={cn(
                'rounded px-3 py-1 text-sm capitalize',
                status === s ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
              )}
            >
              {s === 'new' ? 'To review' : s}
              {s === 'dismissed' && c.dismissed ? ` ${c.dismissed}` : ''}
              {s === 'attached' && c.attached ? ` ${c.attached}` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setMatch(t.key)
              setPage(0)
            }}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              match === t.key ? 'border-foreground bg-foreground text-background' : 'hover:bg-accent',
            )}
          >
            {t.label}
            {t.n != null && <span className="ml-1 tabular-nums opacity-70">{t.n}</span>}
          </button>
        ))}

        <label className="ml-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={industrialOnly}
            onChange={(e) => {
              setIndustrialOnly(e.target.checked)
              setPage(0)
            }}
          />
          Industrial / land only
        </label>

        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Address, city or broker…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
          />
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <Building2 className="mx-auto size-8 text-muted-foreground/40" />
            <p className="mt-2 font-medium">Nothing here</p>
            <p className="text-sm text-muted-foreground">
              {status === 'new'
                ? 'The queue is clear — the next sweep will bring more.'
                : 'No listings in this bucket yet.'}
            </p>
          </div>
        ) : (
          rows.map((l) => <ListingRow key={l.property_id} l={l} onAttach={setAttaching} />)
        )}
      </div>

      {total > PAGE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground tabular-nums">
            {page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * PAGE >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <MapPin className="mt-0.5 size-3 shrink-0" />
        A listing with no parcel and no coordinates cannot appear on the War Room map. Attaching
        it to a property is what puts it back on the board.
      </p>

      <AttachDialog listing={attaching} onClose={() => setAttaching(null)} />
    </div>
  )
}
