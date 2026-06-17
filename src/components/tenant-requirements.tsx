import { rangeSummary } from '@/components/tenant-rep-card'
import { propertyKindLabels } from '@/components/property-form-dialog'
import type { Tables } from '@/lib/database.types'
import { formatSf } from '@/lib/format'
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

/** Read-only requirement breakdown shown on the tenant board sidebar. */
export function TenantRequirements({ tenantRep }: { tenantRep: TenantRep }) {
  const rows: { label: string; value: string | null }[] = [
    { label: 'Industry', value: tenantRep.company?.industry ?? null },
    { label: 'Purpose', value: tenantRep.purpose ? purposeLabels[tenantRep.purpose] : null },
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
    { label: 'Target markets', value: tenantRep.target_markets },
    { label: 'Budget', value: tenantRep.budget },
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
