import type { Enums } from '@/lib/database.types'

export type ZoningKind = Enums<'zoning_kind'>

/** Display labels for the zoning buckets — Alex's four first, structure after. */
export const zoningKindLabels: Record<ZoningKind, string> = {
  industrial: 'Industrial',
  office: 'Office',
  retail: 'Retail',
  multifamily: 'Multifamily',
  residential: 'Residential',
  agricultural: 'Agricultural',
  mixed_use: 'Mixed use',
  planned_development: 'Planned dev',
  other: 'Other',
}

/** The order the zoning filter offers — the four he works lead. */
export const ZONING_FILTER_ORDER: ZoningKind[] = [
  'industrial', 'office', 'retail', 'multifamily',
  'residential', 'agricultural', 'mixed_use', 'planned_development', 'other',
]

/**
 * The county's DOR use code, bucketed for humans.
 *
 * This is the USE axis: what the parcel is recorded as being today, as opposed to what
 * zoning allows it to become. The buckets exist so "single family home but zoned
 * industrial" is a dropdown pick, not a DOR-code lookup. Codes are FDOR standard
 * (three digits, zero-padded; county variants normalize the same way the classifier does).
 */
export type DorBucket =
  | 'vacant' | 'single_family' | 'mobile_home' | 'multifamily' | 'condo'
  | 'retail_commercial' | 'office' | 'industrial' | 'agricultural'
  | 'institutional_gov' | 'other'

export const dorBucketLabels: Record<DorBucket, string> = {
  vacant: 'Vacant land',
  single_family: 'Single family',
  mobile_home: 'Mobile home',
  multifamily: 'Multifamily',
  condo: 'Condo',
  retail_commercial: 'Commercial / retail',
  office: 'Office',
  industrial: 'Industrial',
  agricultural: 'Agricultural',
  institutional_gov: 'Institutional / gov',
  other: 'Other',
}

export const DOR_FILTER_ORDER: DorBucket[] = [
  'industrial', 'vacant', 'single_family', 'retail_commercial', 'office',
  'multifamily', 'mobile_home', 'condo', 'agricultural', 'institutional_gov', 'other',
]

/**
 * Normalize a stored DOR code to its integer (mirrors property_kind_from_dor — keep in
 * lockstep). County CAMA variants append a two-digit subtype: 4-digit codes are 2-digit
 * FDOR class + subtype ('4804' → 48 warehousing, '0100' → 01 single family), Pasco's
 * 5-digit codes are the full 3-digit FDOR code + subtype ('04800' → 048). Verified
 * against the FDOR NAL roll parcel-by-parcel, 2026-08-15.
 */
export function dorInt(code: string | null | undefined): number | null {
  const d = (code ?? '').replace(/\D/g, '')
  if (!d) return null
  return parseInt(d.length === 4 ? d.slice(0, 2) : d.length >= 5 ? d.slice(0, 3) : d, 10)
}

/**
 * Industrial USE, the county's word: the DOR industrial range plus vehicle
 * sales/repair/garages (027) — Alex's niche rides with industrial whatever the
 * classifier's standard bucket says. Vacant industrial (040) counts too.
 */
export function isIndustrialUse(code: string | null | undefined): boolean {
  const v = dorInt(code)
  return v != null && ((v >= 40 && v <= 49) || v === 27)
}

/**
 * A stored DOR value normalized to the FDOR standard 3-digit code, via dorInt's
 * county-variant rules ('4804' → 48 → '048'). Values that still land outside 000–099
 * are genuinely county-specific: the picker lists them as custom codes (county in
 * italics) and they match verbatim per county, never by normalization.
 */
export function dorNorm(code: string | null | undefined): string | null {
  const v = dorInt(code)
  return v != null && v >= 0 && v <= 99 ? String(v).padStart(3, '0') : null
}

/**
 * Does a row answer the DOR-code picker's checked set? Two vocabularies, checked in
 * order: `County|RawCode` (a county-specific custom code, verbatim — Sarasota's 4804
 * only ever means Sarasota's 4804) and the normalized standard 3-digit code.
 */
export function matchesDorCodes(
  county: string | null | undefined,
  code: string | null | undefined,
  checked: ReadonlySet<string>,
): boolean {
  const raw = (code ?? '').trim()
  if (!raw) return false
  if (county && checked.has(`${county}|${raw}`)) return true
  const norm = dorNorm(raw)
  return norm != null && checked.has(norm)
}

export function dorBucket(code: string | null | undefined): DorBucket | null {
  const v = dorInt(code)
  if (v == null || Number.isNaN(v)) return null
  if (v === 1) return 'single_family'
  if (v === 2) return 'mobile_home'
  if (v === 3 || v === 8) return 'multifamily'
  if (v >= 4 && v <= 7) return 'condo'
  // vacant of any flavour reads as land: residential (0), commercial (10), industrial (40)
  if (v === 0 || v === 10 || v === 40) return 'vacant'
  if (v >= 17 && v <= 19) return 'office'
  if ((v >= 11 && v <= 16) || (v >= 20 && v <= 39)) return 'retail_commercial'
  if (v >= 41 && v <= 49) return 'industrial'
  if (v >= 50 && v <= 69) return 'agricultural'
  if (v >= 70 && v <= 98) return 'institutional_gov'
  return 'other'
}

/**
 * One-tap client searches — each chip is a preset over the two axes. `use`/`zoning`
 * land in the same filter state the panel edits, so a chip is a starting point you can
 * tweak, not a mode you are trapped in. 'non_industrial' is a real zoning filter value:
 * "used industrial but not zoned for it" is the grandfathered cohort — expansion-risk
 * owners and future relocation tenants both.
 */
export const ZONING_PLAYS: {
  key: string
  label: string
  hint: string
  use: DorBucket | 'all'
  zoning: ZoningKind | 'industrial_any' | 'non_industrial' | 'all'
}[] = [
  {
    key: 'all_ind',
    label: 'All industrial',
    hint: 'Zoned industrial (incl. CG/CI/BPC) PLUS anything with an industrial county use that is not zoned for it',
    use: 'all',
    zoning: 'industrial_any',
  },
  {
    key: 'house_on_ind',
    label: 'House on industrial land',
    hint: 'Single-family homes on industrially-zoned lots — teardown / land plays',
    use: 'single_family',
    zoning: 'industrial',
  },
  {
    key: 'vacant_ind',
    label: 'Vacant, zoned industrial',
    hint: 'Empty land where industrial can be built',
    use: 'vacant',
    zoning: 'industrial',
  },
  {
    key: 'grandfathered',
    label: 'Grandfathered industrial',
    hint: 'Used industrial but NOT zoned for it — relocation-risk owners and tenants',
    use: 'industrial',
    zoning: 'non_industrial',
  },
]
