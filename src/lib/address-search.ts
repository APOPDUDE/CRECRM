// Forgiving address matching for the property search box (list + Deal Map).
//
// A property's address is split across columns (address / city / state / zip), and the scraped
// rows are inconsistent: some cram the whole address into `address` with the other columns null,
// some store state as "Florida" and zip as ZIP+4. A single substring test against one field can
// therefore only ever match the format it happens to be stored in — typing the full
// "3206 Sydney Rd Plant City, FL 33566" found nothing while "3206 Sydney Rd" worked.
//
// So: fold both sides to one canonical form (abbreviations, no punctuation) and require every
// token of the query to appear somewhere in the property's combined text, in any order.

/** Long form -> the abbreviation we canonicalize on. Applied to stored text and query alike. */
const ABBREV: Record<string, string> = {
  // street types
  road: 'rd', street: 'st', avenue: 'ave', av: 'ave', drive: 'dr', boulevard: 'blvd',
  lane: 'ln', court: 'ct', circle: 'cir', highway: 'hwy', parkway: 'pkwy', pky: 'pkwy',
  pkway: 'pkwy', place: 'pl', terrace: 'ter', trail: 'trl', square: 'sq', expressway: 'expy',
  freeway: 'fwy', turnpike: 'tpke', route: 'rt', suite: 'ste', apartment: 'apt', building: 'bldg',
  // name prefixes that are conventionally abbreviated
  saint: 'st', fort: 'ft', mount: 'mt',
  // directionals
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
  // state names -> USPS codes (the data is ~99% FL but carries a handful of others)
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca', colorado: 'co',
  connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id',
  illinois: 'il', indiana: 'in', iowa: 'ia', kansas: 'ks', kentucky: 'ky', louisiana: 'la',
  maine: 'me', maryland: 'md', massachusetts: 'ma', michigan: 'mi', minnesota: 'mn',
  mississippi: 'ms', missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv',
  ohio: 'oh', oklahoma: 'ok', oregon: 'or', pennsylvania: 'pa', tennessee: 'tn', texas: 'tx',
  utah: 'ut', vermont: 'vt', virginia: 'va', washington: 'wa', wisconsin: 'wi', wyoming: 'wy',
}

/**
 * Canonical form: lowercase, ZIP+4 reduced to the 5-digit zip, punctuation dropped, and every
 * token folded through ABBREV. "3206 Sydney Road, Plant City, Florida 33566-1234" and
 * "3206 Sydney Rd Plant City FL 33566" both become "3206 sydney rd plant city fl 33566".
 */
export function normalizeAddressText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(\d{5})-\d{4}\b/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((t) => ABBREV[t] ?? t)
    .join(' ')
}

/** The typed query as canonical tokens. Empty when the user hasn't typed anything meaningful. */
export function searchTokens(query: string): string[] {
  const normalized = normalizeAddressText(query)
  return normalized ? normalized.split(' ') : []
}

/**
 * Build one searchable string for a record. Nulls are dropped; the result is already canonical,
 * so callers should memoize it per record rather than rebuild it on every keystroke.
 */
export function buildHaystack(parts: Array<string | null | undefined>): string {
  return normalizeAddressText(parts.filter(Boolean).join(' '))
}

/**
 * Every token must appear in the haystack, in any order. Substring (not whole-word) matching is
 * deliberate: it keeps the box responsive while a word is still half-typed.
 */
export function matchesTokens(haystack: string, tokens: string[]): boolean {
  for (const t of tokens) if (!haystack.includes(t)) return false
  return true
}
