import { MoreHorizontal, RotateCcw, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DealTypeBadge } from '@/components/deal-type-badge'
import type { TenantRepWithRelations } from '@/hooks/use-tenant-reps'
import { sizeSummary } from '@/lib/tenant-rep-summary'
import { livePursuits } from '@/lib/stages'
import { isOverdue } from '@/lib/dates'

interface TenantRepCardProps {
  tenantRep: TenantRepWithRelations
  onOpen?: (tenantRep: TenantRepWithRelations) => void
  onMarkLost?: (tenantRep: TenantRepWithRelations) => void
  onReopen?: (tenantRep: TenantRepWithRelations) => void
}

// stop dnd-kit's pointer sensor from treating menu interaction as a drag
// Stop the kanban Mouse/Touch sensors from treating menu interaction as a card drag —
// covers mousedown (MouseSensor) and touchstart (TouchSensor).
const stopDrag = (e: React.SyntheticEvent) => e.stopPropagation()

function tenantName(tenantRep: TenantRepWithRelations): string {
  if (tenantRep.company?.name) return tenantRep.company.name
  if (tenantRep.contact) {
    const name = [tenantRep.contact.first_name, tenantRep.contact.last_name]
      .filter(Boolean)
      .join(' ')
    if (name) return name
  }
  return 'Untitled tenant'
}

export function TenantRepCard({ tenantRep, onOpen, onMarkLost, onReopen }: TenantRepCardProps) {
  const inPlay = livePursuits(tenantRep.matches)
  const overdue =
    tenantRep.status !== 'closed' &&
    tenantRep.status !== 'lost' &&
    isOverdue(tenantRep.next_action_date)
  const summary = sizeSummary(tenantRep)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(tenantRep)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen?.(tenantRep)
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
            <span className="truncate text-sm font-medium">{tenantName(tenantRep)}</span>
          </div>
          {summary && <div className="truncate text-xs text-muted-foreground">{summary}</div>}
        </div>
        {(onMarkLost || onReopen) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-mt-1 -mr-1 size-7 shrink-0"
                onMouseDown={stopDrag}
                onTouchStart={stopDrag}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-4" />
                <span className="sr-only">Tenant actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onMouseDown={stopDrag}
              onTouchStart={stopDrag}
              onClick={(e) => e.stopPropagation()}
            >
              {onMarkLost && tenantRep.status !== 'closed' && tenantRep.status !== 'lost' && (
                <DropdownMenuItem variant="destructive" onSelect={() => onMarkLost(tenantRep)}>
                  <XCircle className="size-4" />
                  Mark lost
                </DropdownMenuItem>
              )}
              {onReopen && tenantRep.status === 'lost' && (
                <DropdownMenuItem onSelect={() => onReopen(tenantRep)}>
                  <RotateCcw className="size-4" />
                  Reopen
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <DealTypeBadge dealType={tenantRep.deal_type} />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <Badge variant="secondary" className="font-normal">
          {inPlay.length} in play
        </Badge>
      </div>
    </div>
  )
}
