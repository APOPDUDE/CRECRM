// County appraisers expect parcel IDs in their own dashed format. Brokers paste them raw
// (no separators), so format on input to remove room for error. Patterns are the digit
// groupings each county's parcel/strap uses — derived from parcels that enriched cleanly:
//   Pinellas  15-29-15-64890-004-0010   (2-2-2-5-3-4)
//   Pasco     16-25-21-0000-00900-0010  (2-2-2-4-5-4)
//   Polk      25-28-23-000000-021020    (2-2-2-6-6)
//   Manatee   15346-0000-0              (5-4-1)
//   Sarasota  0043-13-0001              (4-2-4)
// Hillsborough is a letter-prefixed PIN or a numeric folio, so it's left as typed.
const PARCEL_PATTERNS: Record<string, number[]> = {
  Pinellas: [2, 2, 2, 5, 3, 4],
  Pasco: [2, 2, 2, 4, 5, 4],
  Polk: [2, 2, 2, 6, 6],
  Manatee: [5, 4, 1],
  Sarasota: [4, 2, 4],
}

/**
 * Counties with a working appraiser adapter (so a parcel-only add can auto-enrich). Superset
 * of PARCEL_PATTERNS — Hillsborough enriches but its PIN/folio is left as typed.
 */
export const ENRICHABLE_COUNTIES = ['Hillsborough', 'Pinellas', 'Pasco', 'Polk', 'Manatee', 'Sarasota']

/**
 * Format a raw parcel ID into its county's dashed format. If the county has no known
 * pattern (e.g. Hillsborough), or the digit count doesn't match (so we'd risk mangling a
 * valid-but-different ID), the input is returned trimmed but otherwise untouched.
 */
export function formatParcelId(raw: string, county: string | null | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed || !county) return trimmed
  const pattern = PARCEL_PATTERNS[county]
  if (!pattern) return trimmed
  const digits = trimmed.replace(/\D/g, '')
  const expected = pattern.reduce((a, b) => a + b, 0)
  if (digits.length !== expected) return trimmed
  const parts: string[] = []
  let i = 0
  for (const len of pattern) {
    parts.push(digits.slice(i, i + len))
    i += len
  }
  return parts.join('-')
}
