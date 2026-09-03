import type { TenantRepWithRelations } from '@/hooks/use-tenant-reps'
import { formatSf } from '@/lib/format'
import { propertyKindLabels } from '@/lib/labels'

/** A min–max range like "80,000–120,000 SF", "80,000 SF+", "up to 120,000 SF". */
export function rangeSummary(
  min: number | null,
  max: number | null,
  unit: (n: number) => string | null,
): string | null {
  if (min != null && max != null) return `${min.toLocaleString('en-US')}–${unit(max)}`
  if (min != null) return `${unit(min)}+`
  if (max != null) return `up to ${unit(max)}`
  return null
}

const acres = (n: number) => `${n} AC`

/** Short card summary — building SF first, then land acres, then a sensible fallback. */
export function sizeSummary(tenantRep: TenantRepWithRelations): string | null {
  return (
    rangeSummary(tenantRep.building_sf_min, tenantRep.building_sf_max, formatSf) ||
    rangeSummary(tenantRep.land_acres_min, tenantRep.land_acres_max, acres) ||
    (tenantRep.property_type ? propertyKindLabels[tenantRep.property_type] : null) ||
    tenantRep.must_haves ||
    tenantRep.target_markets ||
    null
  )
}
