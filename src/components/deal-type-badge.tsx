import { Badge } from '@/components/ui/badge'
import type { Enums } from '@/lib/database.types'
import { cn } from '@/lib/utils'

export const dealTypeLabels: Record<Enums<'deal_type'>, string> = {
  lease: 'Lease',
  sale: 'Sale',
  both: 'Both',
}

const dealTypeStyles: Record<Enums<'deal_type'>, string> = {
  lease: 'border-blue-200 bg-blue-50 text-blue-700',
  sale: 'border-violet-200 bg-violet-50 text-violet-700',
  both: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

/** Lease / Sale / Both badge, used on listing and tenant-rep cards. */
export function DealTypeBadge({ dealType }: { dealType: Enums<'deal_type'> | null }) {
  if (!dealType) return null
  return (
    <Badge variant="outline" className={cn('font-medium', dealTypeStyles[dealType])}>
      {dealTypeLabels[dealType]}
    </Badge>
  )
}
