import { rangeSummary } from '@/components/tenant-rep-card'
import { propertyKindLabels } from '@/components/property-form-dialog'
import type { Tables } from '@/lib/database.types'
import {
  buyerKindLabels,
  industrialSubclassLabels,
  investmentStrategyLabels,
  parseTargetAreas,
} from '@/lib/clients'
import { formatCurrency, formatSf } from '@/lib/format'
import { formatDate } from '@/lib/dates'

type TenantRep = Tables<'clients'> & {
  company?: Pick<Tables<'companies'>, 'industry'> | null
}

const acres = (n: number) => `${n} AC`

const purposeLabels: Record<Tables<'clients'>['purpose'] & string, string> = {
  expansion: 'Expansion',
  first_location: 'First location',
  relocation: 'Relocation',
  investment: 'Investment',
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

function priceRange(min: number | null, max: number | null): string | null {
  const lo = formatCurrency(min)
  const hi = formatCurrency(max)
  if (lo && hi) return `${lo} – ${hi}`
  return lo ? `${lo}+` : hi ? `Up to ${hi}` : null
}

/** Read-only requirement breakdown shown on the tenant board sidebar. */
export function TenantRequirements({ tenantRep }: { tenantRep: TenantRep }) {
  const areas = parseTargetAreas(tenantRep.target_areas)
  const rows: { label: string; value: string | null }[] = [
    { label: 'Industry', value: tenantRep.company?.industry ?? null },
    { label: 'Purpose', value: tenantRep.purpose ? purposeLabels[tenantRep.purpose] : null },
    {
      label: 'Buyer type',
      value: tenantRep.buyer_kind ? buyerKindLabels[tenantRep.buyer_kind] : null,
    },
    {
      label: 'Product',
      value:
        tenantRep.product_subclasses?.map((s) => industrialSubclassLabels[s]).join(', ') || null,
    },
    {
      label: 'Strategy',
      value: tenantRep.strategies?.map((s) => investmentStrategyLabels[s]).join(', ') || null,
    },
    { label: 'Price', value: priceRange(tenantRep.price_min, tenantRep.price_max) },
    {
      label: '1031 deadline',
      value: tenantRep.exchange_1031
        ? (formatDate(tenantRep.exchange_deadline) ?? 'No date set')
        : null,
    },
    { label: 'Areas', value: areas.map((a) => a.name).join(', ') || null },
    { label: 'Move-in', value: formatDate(tenantRep.move_in_date) },
    {
      label: 'Type',
      value: tenantRep.property_type ? propertyKindLabels[tenantRep.property_type] : null,
    },
    {
      label: 'Building',
      value: rangeSummary(tenantRep.building_sf_min, tenantRep.building_sf_max, formatSf),
    },
    {
      label: 'Land',
      value: rangeSummary(tenantRep.land_acres_min, tenantRep.land_acres_max, acres),
    },
    {
      label: 'Min cap rate',
      value: tenantRep.cap_rate_min != null ? `${tenantRep.cap_rate_min}%` : null,
    },
    { label: 'Rent budget', value: priceRange(tenantRep.rent_budget_min, tenantRep.rent_budget_max) },
  ]
  const populated = rows.filter((r) => r.value)

  if (populated.length === 0 && !tenantRep.must_haves) {
    return <p className="text-sm text-muted-foreground">No requirements captured yet.</p>
  }

  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      {populated.map((r) => (
        <Row key={r.label} label={r.label} value={r.value} />
      ))}
      {tenantRep.must_haves && (
        <p className="border-t pt-2 text-sm whitespace-pre-wrap">{tenantRep.must_haves}</p>
      )}
    </div>
  )
}
