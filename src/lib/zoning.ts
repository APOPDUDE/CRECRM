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
 * The major use categories the picker offers as one-click layers (Alex).
 *
 * `land` is the land book's axis (Alex 2026-08-21) and is ORTHOGONAL to the other
 * four rather than a fifth slice of them: dor_codes.land_class flags 000/010/040/
 * 050-069/070/099, and 040 stays filed under `industrial` for the normal book while
 * also being land. So `land` never resolves through `categoryOf` — it matches
 * against the land_class set passed to matchesDorSelection.
 */
export const DOR_MAJORS = ['industrial', 'retail', 'office', 'multifamily', 'land'] as const
export type DorMajor = (typeof DOR_MAJORS)[number]

/** What one major paints: nothing, its whole category, or a hand-picked code subset. */
export type DorLayerSelection = 'off' | 'all' | string[]

/**
 * The DOR picker's state, shaped like the zoning layers (Alex, 2026-08-16): four
 * major categories as tri-state layers, plus `extra` — checked codes OUTSIDE the
 * majors (standard 'other' codes like 001, and county customs keyed `County|Raw`).
 */
export type DorSelection = {
  industrial: DorLayerSelection
  retail: DorLayerSelection
  office: DorLayerSelection
  multifamily: DorLayerSelection
  land: DorLayerSelection
  extra: string[]
}

export const DOR_SELECTION_DEFAULT: DorSelection = {
  industrial: 'off',
  retail: 'off',
  office: 'off',
  multifamily: 'off',
  land: 'off',
  extra: [],
}

/** A persisted value predating a shape change must not crash the filter. */
export function safeDorSelection(v: unknown): DorSelection {
  const o = (v ?? {}) as Partial<DorSelection>
  const sel = (s: unknown): DorLayerSelection =>
    s === 'all' || s === 'off' ? s : Array.isArray(s) ? s.filter((k): k is string => typeof k === 'string') : 'off'
  return {
    industrial: sel(o.industrial),
    retail: sel(o.retail),
    office: sel(o.office),
    multifamily: sel(o.multifamily),
    land: sel(o.land),
    extra: Array.isArray(o.extra) ? o.extra.filter((k): k is string => typeof k === 'string') : [],
  }
}

export function dorSelectionActive(sel: DorSelection): boolean {
  return DOR_MAJORS.some((m) => sel[m] !== 'off') || sel.extra.length > 0
}

/**
 * Does a row answer the picker? A category on 'all' matches every code the dor_codes
 * table files under it (`categoryOf`, from the seeded list — 027 rides with
 * industrial there, per Alex); a subset matches its checked codes; `extra` matches
 * standard codes by normalization and county customs verbatim.
 */
export function matchesDorSelection(
  county: string | null | undefined,
  code: string | null | undefined,
  sel: DorSelection,
  categoryOf: ReadonlyMap<string, string>,
  /** Codes flagged dor_codes.land_class — what the `land` major paints. */
  landCodes?: ReadonlySet<string>,
): boolean {
  const raw = (code ?? '').trim()
  if (!raw) return false
  const customKey = county ? `${county}|${raw}` : null
  const norm = dorNorm(raw)
  if (customKey && sel.extra.includes(customKey)) return true
  if (norm != null && sel.extra.includes(norm)) return true
  if (norm == null) return false
  const category = categoryOf.get(norm)
  for (const major of DOR_MAJORS) {
    const s = sel[major]
    if (s === 'off') continue
    // `land` is a flag, not a category: 040 is industrial AND land, so it can
    // never resolve through categoryOf (see DOR_MAJORS).
    const whole = major === 'land' ? (landCodes?.has(norm) ?? false) : category === major
    if (s === 'all' ? whole : s.includes(norm)) return true
  }
  return false
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
  // 027 (auto sales/repair/garages) is Alex's niche and files as INDUSTRIAL on every
  // axis — property_kind_from_dor, the dor_codes picker seed, isIndustrialUse and here —
  // whatever FDOR's standard commercial grouping says (Alex, 2026-08-16: "2703 … should
  // be industrial").
  if ((v >= 11 && v <= 16) || (v >= 20 && v <= 39 && v !== 27)) return 'retail_commercial'
  if ((v >= 41 && v <= 49) || v === 27) return 'industrial'
  if (v >= 50 && v <= 69) return 'agricultural'
  if (v >= 70 && v <= 98) return 'institutional_gov'
  return 'other'
}

// The ZONING_PLAYS preset chips lived here 2026-08-15 → 16; Alex removed them from the
// War Room ("remove the all industrial house on industrial vacant..."). The same
// searches remain one or two rail picks: All industrial = zoning 'industrial_any';
// House on industrial = DOR 001 + zoning 'industrial'; Grandfathered = DOR industrial
// category + zoning 'non_industrial'.
