import { Badge } from '@/components/ui/badge'
import { SourceBadge } from '@/components/source-badge'
import type { MatchWithRelations } from '@/hooks/use-matches'
import { contactNameOf } from '@/hooks/use-contacts'
import { daysAgoLabel } from '@/lib/dates'

interface MatchCardProps {
  match: MatchWithRelations
  /** "property" board shows the tenant; "tenant" board shows the property. */
  facing: 'property' | 'tenant'
  onOpen?: (match: MatchWithRelations) => void
}

export function MatchCard({ match, facing, onOpen }: MatchCardProps) {
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

  return (
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
      className="w-full cursor-grab rounded-lg border bg-card p-3 text-left shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {facing === 'tenant' && match.listing_id && (
          <Badge variant="secondary" className="shrink-0 font-normal">
            My listing
          </Badge>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <SourceBadge source={match.source} brokerName={brokerName} />
        {days && (
          <span className="text-xs text-muted-foreground">
            {days === 'today' ? 'today' : `${days} ago`}
          </span>
        )}
      </div>
    </div>
  )
}
