import { Badge } from '@/components/ui/badge'
import type { Enums } from '@/lib/database.types'
import { leadSourceConfig } from '@/lib/labels'
import type { ListingSource } from '@/lib/listing-source'

type LeadSource = Enums<'lead_source'>

interface SourceBadgeProps {
  source: LeadSource | null | undefined
  /** Broker-sourced records can show the referring broker's name. */
  brokerName?: string | null
}

export function SourceBadge({ source, brokerName }: SourceBadgeProps) {
  if (!source) return null
  const config = leadSourceConfig[source]
  const label =
    source === 'broker' && brokerName ? `${config.label} · ${brokerName}` : config.label
  return (
    <Badge variant="outline" className={config.className}>
      {label}
    </Badge>
  )
}

// --- Listing source (where a property listing came from) --------------------
// Distinct from lead_source: this is the marketplace a property was scraped or
// entered from, shown on the tenant board so a Crexi listing reads "Crexi".
const listingSourceConfig: Record<ListingSource, { label: string; className: string }> = {
  crexi: { label: 'Crexi', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  loopnet: { label: 'LoopNet', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  manual: { label: 'Manual', className: 'bg-slate-50 text-slate-600 border-slate-200' },
}

export function ListingSourceBadge({ source }: { source: ListingSource | null | undefined }) {
  if (!source) return null
  const config = listingSourceConfig[source]
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  )
}
