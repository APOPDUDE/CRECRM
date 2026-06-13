import { MoreHorizontal, RotateCcw, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SourceBadge } from '@/components/source-badge'
import { propertyKindLabels } from '@/components/property-form-dialog'
import type { TenantRepWithRelations } from '@/hooks/use-tenant-reps'
import { formatSf } from '@/lib/format'
import { liveMatches } from '@/lib/stages'
import { isOverdue } from '@/lib/dates'

interface TenantRepCardProps {
  tenantRep: TenantRepWithRelations
  onMarkLost?: (tenantRep: TenantRepWithRelations) => void
  onReopen?: (tenantRep: TenantRepWithRelations) => void
}

// stop dnd-kit's pointer sensor from treating menu interaction as a drag
const stopDrag = (e: React.PointerEvent) => e.stopPropagation()

/** Short size requirement summary, e.g. "80,000–120,000 SF", "80,000 SF+", "up to 120,000 SF". */
export function sizeSummary(tenantRep: TenantRepWithRelations): string | null {
  const { size_min_sf, size_max_sf } = tenantRep
  if (size_min_sf != null && size_max_sf != null) {
    return `${size_min_sf.toLocaleString('en-US')}–${formatSf(size_max_sf)}`
  }
  if (size_min_sf != null) return `${formatSf(size_min_sf)}+`
  if (size_max_sf != null) return `up to ${formatSf(size_max_sf)}`
  if (tenantRep.property_type) return propertyKindLabels[tenantRep.property_type]
  // fall back to the free-text requirements (what the quick-add captures) or target area
  return tenantRep.must_haves || tenantRep.target_area || null
}

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

export function TenantRepCard({ tenantRep, onMarkLost, onReopen }: TenantRepCardProps) {
  const inPlay = liveMatches(tenantRep.matches)
  const overdue = tenantRep.status === 'active' && isOverdue(tenantRep.next_action_date)
  const summary = sizeSummary(tenantRep)
  const brokerName = tenantRep.broker
    ? [tenantRep.broker.first_name, tenantRep.broker.last_name].filter(Boolean).join(' ')
    : null

  return (
    <div className="cursor-grab rounded-lg border bg-card p-3 shadow-sm active:cursor-grabbing">
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
                onPointerDown={stopDrag}
              >
                <MoreHorizontal className="size-4" />
                <span className="sr-only">Tenant actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onPointerDown={stopDrag}>
              {onMarkLost && tenantRep.status === 'active' && (
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
        <SourceBadge source={tenantRep.source} brokerName={brokerName} />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <Badge variant="secondary" className="font-normal">
          {inPlay.length} in play
        </Badge>
      </div>
    </div>
  )
}
