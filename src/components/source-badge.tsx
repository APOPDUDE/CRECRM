import { Badge } from '@/components/ui/badge'
import type { Enums } from '@/lib/database.types'

type LeadSource = Enums<'lead_source'>

// Source colors are consistent app-wide (boards, match cards, detail panels).
const sourceConfig: Record<LeadSource, { label: string; className: string }> = {
  loopnet: { label: 'LoopNet', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  sign_call: { label: 'Sign call', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  cold_call: { label: 'Cold call', className: 'bg-slate-50 text-slate-600 border-slate-200' },
  email: { label: 'Email', className: 'bg-violet-50 text-violet-700 border-violet-200' },
  text: { label: 'Text', className: 'bg-teal-50 text-teal-700 border-teal-200' },
  website: { label: 'Website', className: 'bg-green-50 text-green-700 border-green-200' },
  referral: { label: 'Referral', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  broker: { label: 'Broker', className: 'bg-orange-50 text-orange-700 border-orange-200' },
}

export const leadSourceLabels = Object.fromEntries(
  Object.entries(sourceConfig).map(([k, v]) => [k, v.label]),
) as Record<LeadSource, string>

interface SourceBadgeProps {
  source: LeadSource | null | undefined
  /** Broker-sourced records can show the referring broker's name. */
  brokerName?: string | null
}

export function SourceBadge({ source, brokerName }: SourceBadgeProps) {
  if (!source) return null
  const config = sourceConfig[source]
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
export type ListingSource = 'crexi' | 'loopnet' | 'manual'

const listingSourceConfig: Record<ListingSource, { label: string; className: string }> = {
  crexi: { label: 'Crexi', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  loopnet: { label: 'LoopNet', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  manual: { label: 'Manual', className: 'bg-slate-50 text-slate-600 border-slate-200' },
}

/** Derive a property's listing source from its dedupe key, URL, then source col. */
export function listingSourceOf(p: {
  source_key?: string | null
  listing_url?: string | null
  source?: string | null
}): ListingSource | null {
  const key = p.source_key ?? ''
  if (key.startsWith('crexi:')) return 'crexi'
  if (key.startsWith('loopnet:')) return 'loopnet'
  const url = p.listing_url ?? ''
  if (/crexi\.com/i.test(url)) return 'crexi'
  if (/loopnet\.com/i.test(url)) return 'loopnet'
  if (p.source === 'manual') return 'manual'
  return null
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
