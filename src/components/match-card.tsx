import { Eye } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SourceBadge } from '@/components/source-badge'
import type { MatchWithRelations } from '@/hooks/use-matches'
import { contactNameOf } from '@/hooks/use-contacts'
import { daysAgoLabel } from '@/lib/dates'

interface MatchCardProps {
  match: MatchWithRelations
  /** "property" board shows the tenant; "tenant" board shows the property. */
  facing: 'property' | 'tenant'
  /** Primary click (e.g. open the full record). */
  onOpen?: (match: MatchWithRelations) => void
  /** Corner preview icon — opens a quick preview. Hidden when not provided. */
  onPreview?: (match: MatchWithRelations) => void
}

export function MatchCard({ match, facing, onOpen, onPreview }: MatchCardProps) {
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
      className="group w-full cursor-grab rounded-lg border bg-card p-3 text-left shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
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
          {match.flagged_new && (
            <Badge variant="outline" className="border-red-200 bg-red-50 font-medium text-red-700">
              New
            </Badge>
          )}
          {facing === 'tenant' && match.listing_id && (
            <Badge variant="secondary" className="font-normal">
              My listing
            </Badge>
          )}
        </div>
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
