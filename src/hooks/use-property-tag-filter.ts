import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * The War Room's Tags filter.
 *
 * Four options that read as one list to Alex but come from three different places in the
 * schema, because the tags genuinely describe different things:
 *
 * - `interested` / `not interested` are about the PERSON, so they live on `companies.tags`
 *   (the owning entity). A property matches when its owner carries the tag.
 * - `owner occupier` is about the BUILDING — an owner with five properties may occupy one
 *   and lease four — so it lives on `properties.tags` and matches the property directly.
 * - `buyer` is not a CRM tag at all. It is a GHL-only tag that queues a review row in
 *   `buyer_intakes`; a property matches when its owner is someone who wants to buy.
 *
 * Resolving all four to a Set of property ids server-side keeps the filter identical in
 * map view and table view. It also keeps it honest on the map, where `ownerCtx` only
 * covers the current viewport — filtering on that would answer a whole-book question with
 * whatever happened to be on screen.
 *
 * These sets are SMALL by nature (tens of rows, not thousands), which is why this is four
 * cheap lookups rather than a column added to `v_map_property`.
 */

/** Stored tag value -> what Alex sees. */
export const PROPERTY_TAG_OPTIONS = [
  { key: 'interested', label: 'Interested' },
  { key: 'not interested', label: 'Not interested' },
  // Alex calls this "owner operator"; the stored tag (and the GHL tag, and the sync's
  // managed vocabulary) is 'owner occupier'. Kept as a DISPLAY alias on purpose — his
  // 2026-08-17 call was to populate the existing tag, not to mint a second name for it.
  // Renaming the stored value is a one-migration job for a session that has SQL access.
  { key: 'owner occupier', label: 'Owner operator' },
  { key: 'buyer', label: 'Buyer' },
] as const

export type PropertyTagKey = (typeof PROPERTY_TAG_OPTIONS)[number]['key']

const TAG_KEYS = new Set<string>(PROPERTY_TAG_OPTIONS.map((o) => o.key))
/** Tags stored on the building itself. */
const PROPERTY_LEVEL = new Set<string>(['owner occupier'])
/** Tags stored on the owning entity. */
const COMPANY_LEVEL = new Set<string>(['interested', 'not interested'])

export function safeTagFilter(v: unknown): PropertyTagKey[] {
  if (!Array.isArray(v)) return []
  return v.filter((t): t is PropertyTagKey => typeof t === 'string' && TAG_KEYS.has(t))
}

export function tagLabel(key: string): string {
  return PROPERTY_TAG_OPTIONS.find((o) => o.key === key)?.label ?? key
}

const PAGE = 1000

/** Every property owned by any of these companies. Paged — a missing limit truncates silently. */
async function propertiesOfCompanies(companyIds: string[]): Promise<string[]> {
  if (companyIds.length === 0) return []
  const out: string[] = []
  // Chunk the IN list so a long one cannot overflow the URL, and page each chunk.
  for (let i = 0; i < companyIds.length; i += 200) {
    const chunk = companyIds.slice(i, i + 200)
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('properties')
        .select('id')
        .in('owner_company_id', chunk)
        .range(from, from + PAGE - 1)
      if (error) throw error
      const rows = data ?? []
      out.push(...rows.map((r) => r.id))
      if (rows.length < PAGE) break
    }
  }
  return out
}

/**
 * Property ids carrying ANY of the selected tags.
 *
 * OR across the selected tags, which is what a multi-select tag filter means — "show me
 * the interested ones and the owner operators", not "the ones that are somehow both".
 */
export function useTaggedPropertyIds(tags: PropertyTagKey[]) {
  // Sorted so ['buyer','interested'] and ['interested','buyer'] share one cache entry.
  const active = [...new Set(tags)].sort()
  const query = useQuery({
    queryKey: ['property-tag-ids', active],
    enabled: active.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Set<string>> => {
      const ids = new Set<string>()

      const propTags = active.filter((t) => PROPERTY_LEVEL.has(t))
      const compTags = active.filter((t) => COMPANY_LEVEL.has(t))
      const wantsBuyer = active.includes('buyer')

      // ---- tags on the building
      if (propTags.length) {
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from('properties')
            .select('id')
            .overlaps('tags', propTags)
            .range(from, from + PAGE - 1)
          if (error) throw error
          const rows = data ?? []
          for (const r of rows) ids.add(r.id)
          if (rows.length < PAGE) break
        }
      }

      // ---- tags on the owning entity
      if (compTags.length) {
        const { data, error } = await supabase
          .from('companies')
          .select('id')
          .overlaps('tags', compTags)
          .limit(PAGE)
        if (error) throw error
        for (const id of await propertiesOfCompanies((data ?? []).map((c) => c.id))) ids.add(id)
      }

      // ---- buyer: a person in the review queue, mapped to what their entity owns.
      // Dismissed intakes are excluded — "not a buyer after all" is the whole point of
      // dismissing one.
      if (wantsBuyer) {
        const { data: intakes, error: iErr } = await supabase
          .from('buyer_intakes')
          .select('contact_id')
          .neq('status', 'dismissed')
          .not('contact_id', 'is', null)
          .limit(PAGE)
        if (iErr) throw iErr
        const contactIds = (intakes ?? []).map((r) => r.contact_id).filter((v): v is string => !!v)
        if (contactIds.length) {
          const companyIds = new Set<string>()
          for (let i = 0; i < contactIds.length; i += 200) {
            const { data, error } = await supabase
              .from('contacts')
              .select('company_id')
              .in('id', contactIds.slice(i, i + 200))
            if (error) throw error
            for (const r of data ?? []) if (r.company_id) companyIds.add(r.company_id)
          }
          for (const id of await propertiesOfCompanies([...companyIds])) ids.add(id)
        }
      }

      return ids
    },
  })
  return {
    /** null while nothing is selected — callers must not filter on an empty set. */
    tagIds: active.length > 0 ? (query.data ?? null) : null,
    isLoading: active.length > 0 && query.isLoading,
    error: query.error,
  }
}
