import { MoreHorizontal, RotateCcw, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ListingWithRelations } from '@/hooks/use-listings'
import { formatListingPrice } from '@/lib/format'
import { hottestStage, liveMatches, matchStageLabels } from '@/lib/stages'
import { isOverdue } from '@/lib/dates'

interface ListingCardProps {
  listing: ListingWithRelations
  onOpen?: (listing: ListingWithRelations) => void
  onMarkLost?: (listing: ListingWithRelations) => void
  onReopen?: (listing: ListingWithRelations) => void
}

// stop dnd-kit's pointer sensor from treating menu interaction as a drag
const stopDrag = (e: React.PointerEvent) => e.stopPropagation()

export function ListingCard({ listing, onOpen, onMarkLost, onReopen }: ListingCardProps) {
  const prospects = liveMatches(listing.matches)
  const hottest = hottestStage(listing.matches)
  const overdue = listing.status === 'active' && isOverdue(listing.next_action_date)
  const price = formatListingPrice(listing)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(listing)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen?.(listing)
        }
      }}
      className="cursor-grab rounded-lg border bg-card p-3 text-left shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {overdue && (
              <span
                className="size-2 shrink-0 rounded-full bg-red-500"
                title="Next action overdue"
              />
            )}
            <span className="truncate text-sm font-medium">
              {listing.property?.address ?? 'Untitled property'}
            </span>
          </div>
          {listing.landlord && (
            <div className="truncate text-xs text-muted-foreground">{listing.landlord.name}</div>
          )}
        </div>
        {(onMarkLost || onReopen) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-mt-1 -mr-1 size-7 shrink-0"
                onPointerDown={stopDrag}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-4" />
                <span className="sr-only">Listing actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onPointerDown={stopDrag}>
              {onMarkLost && listing.status === 'active' && (
                <DropdownMenuItem variant="destructive" onSelect={() => onMarkLost(listing)}>
                  <XCircle className="size-4" />
                  Mark lost
                </DropdownMenuItem>
              )}
              {onReopen && listing.status === 'lost' && (
                <DropdownMenuItem onSelect={() => onReopen(listing)}>
                  <RotateCcw className="size-4" />
                  Reopen
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {price && <span className="text-sm font-medium tabular-nums">{price}</span>}
        <Badge
          variant="outline"
          className={
            listing.deal_type === 'sale'
              ? 'border-violet-200 bg-violet-50 font-medium text-violet-700'
              : 'border-blue-200 bg-blue-50 font-medium text-blue-700'
          }
        >
          {listing.deal_type === 'sale' ? 'Sale' : 'Lease'}
        </Badge>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <Badge variant="secondary" className="font-normal">
          {prospects.length} {prospects.length === 1 ? 'prospect' : 'prospects'}
        </Badge>
        {hottest && (
          <span className="text-xs text-muted-foreground">{matchStageLabels[hottest]}</span>
        )}
      </div>
    </div>
  )
}
