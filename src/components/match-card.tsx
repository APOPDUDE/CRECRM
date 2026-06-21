import { CalendarClock, Eye, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { SourceBadge, ListingSourceBadge, listingSourceOf } from '@/components/source-badge'
import type { MatchWithRelations } from '@/hooks/use-matches'
import { contactNameOf } from '@/hooks/use-contacts'
import { daysAgoLabel, formatDate, formatTimeOfDay } from '@/lib/dates'
import { formatCurrency, formatPsf, formatSf } from '@/lib/format'

interface MatchCardProps {
  match: MatchWithRelations
  /** "property" board shows the tenant; "tenant" board shows the property. */
  facing: 'property' | 'tenant'
  /** Primary click (e.g. open the full record). */
  onOpen?: (match: MatchWithRelations) => void
  /** Corner preview icon — opens a quick preview. Hidden when not provided. */
  onPreview?: (match: MatchWithRelations) => void
  /** Corner trash icon — removes this card from the board. Hidden when not provided. */
  onRemove?: (match: MatchWithRelations) => void
}

export function MatchCard({ match, facing, onOpen, onPreview, onRemove }: MatchCardProps) {
  const brokerName = match.broker ? contactNameOf(match.broker) : null

  const title =
    facing === 'property'
      ? match.tenant_company?.name ??
        (match.tenant_contact ? contactNameOf(match.tenant_contact) : 'Unknown tenant')
      : (match.property?.address ?? 'Unknown property')

  const subtitle =
    facing === 'property'
      ? match.tenant_company && match.tenant_contact
        ? contactNameOf(match.tenant_contact)
        : null
      : [match.property?.city, match.property?.state].filter(Boolean).join(', ') || null

  const days = daysAgoLabel(match.inquiry_date)
  const tourLabel = match.tour_date
    ? [formatDate(match.tour_date), formatTimeOfDay(match.tour_time)].filter(Boolean).join(' · ')
    : null

  // On the tenant board the card is a property — badge where the LISTING came
  // from (Crexi/LoopNet) and show its photo, not the client's lead source.
  const listingSrc = facing === 'tenant' ? listingSourceOf(match.property ?? {}) : null
  const photo = facing === 'tenant' ? match.property?.photo_urls?.[0] : null

  const card = (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(match)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen?.(match)
        }
      }}
      className="group w-full cursor-grab rounded-lg border bg-card p-3 text-left shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {photo && (
            <img
              src={photo}
              alt=""
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
              className="size-10 shrink-0 rounded-md border object-cover"
            />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{title}</div>
            {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onPreview && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onPreview(match)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Eye className="size-3.5" />
                  <span className="sr-only">Preview</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>Preview</TooltipContent>
            </Tooltip>
          )}
          {onRemove && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(match)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                  <span className="sr-only">Remove from board</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>Remove from board</TooltipContent>
            </Tooltip>
          )}
          {match.flagged_new && (
            <Badge variant="outline" className="border-red-200 bg-red-50 font-medium text-red-700">
              New
            </Badge>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {tourLabel ? (
          <Badge variant="outline" className="border-blue-200 bg-blue-50 font-medium text-blue-700">
            <CalendarClock className="size-3" />
            {tourLabel}
          </Badge>
        ) : (
          <>
            {facing === 'tenant' ? (
              <ListingSourceBadge source={listingSrc} />
            ) : (
              <SourceBadge source={match.source} brokerName={brokerName} />
            )}
            {days && (
              <span className="text-xs text-muted-foreground">
                {days === 'today' ? 'today' : `${days} ago`}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )

  // On the tenant board, hovering a property card previews its photo + highlights.
  if (facing === 'tenant' && (photo || match.property?.specs)) {
    const price = [formatPsf(match.property?.asking_rate_psf), formatCurrency(match.property?.asking_price)]
      .filter(Boolean)
      .join(' · ')
    const sf = formatSf(match.property?.building_sf)
    return (
      <HoverCard>
        <HoverCardTrigger asChild>{card}</HoverCardTrigger>
        <HoverCardContent side="right" align="start" className="overflow-hidden">
          {photo && (
            <img
              src={photo}
              alt=""
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
              className="h-36 w-full border-b object-cover"
            />
          )}
          <div className="space-y-1 p-3">
            <div className="text-sm font-medium">{match.property?.address}</div>
            {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
            {(price || sf) && (
              <div className="text-xs text-muted-foreground">
                {[price, sf].filter(Boolean).join(' · ')}
              </div>
            )}
            {match.property?.specs && (
              <p className="line-clamp-3 pt-1 text-xs text-muted-foreground">{match.property.specs}</p>
            )}
          </div>
        </HoverCardContent>
      </HoverCard>
    )
  }

  return card
}
