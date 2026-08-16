import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { dorNorm } from '@/lib/zoning'

/** One row of the DOR-code picker. Standard codes key by their 3-digit code; county
 * customs (values that don't normalize to 000-099, like Sarasota's 4804) key by
 * `County|RawCode` and match verbatim against that county's rows. */
export type DorCodeEntry = {
  key: string
  code: string
  description: string
  /** One of the five general categories Alex wants on hover. */
  category: 'industrial' | 'office' | 'retail' | 'multifamily' | 'other'
  /** Set only on county-specific custom codes — rendered in faint italics. */
  county: string | null
  /** How many book rows carry it (summed across counties for standard codes). */
  count: number
}

/**
 * The picker's rows: the FDOR standard list (dor_codes, seeded 000-099) plus every
 * county-specific value actually present in the book (v_county_dor_codes). Both are
 * near-static — the standard list IS static, and the county list moves only when an
 * import lands — so one fetch per session.
 */
export function useDorCodes(enabled: boolean) {
  return useQuery({
    queryKey: ['dor-codes'],
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<DorCodeEntry[]> => {
      const [std, county] = await Promise.all([
        supabase.from('dor_codes').select('code, description, category').order('code'),
        supabase.from('v_county_dor_codes').select('county, code, property_count'),
      ])
      if (std.error) throw std.error
      if (county.error) throw county.error

      const entries = new Map<string, DorCodeEntry>()
      for (const r of std.data ?? []) {
        entries.set(r.code, {
          key: r.code,
          code: r.code,
          description: r.description,
          category: r.category as DorCodeEntry['category'],
          county: null,
          count: 0,
        })
      }
      const customs: DorCodeEntry[] = []
      for (const r of county.data ?? []) {
        if (!r.code || !r.county) continue
        const norm = dorNorm(r.code)
        const n = r.property_count ?? 0
        if (norm && entries.has(norm)) {
          // a county variant of a standard code ('0100' → '010'): counts roll up
          entries.get(norm)!.count += n
        } else {
          customs.push({
            key: `${r.county}|${r.code}`,
            code: r.code,
            description: 'County-specific code',
            category: 'other',
            county: r.county,
            count: n,
          })
        }
      }
      // standard list in code order, then the customs by weight — the heavy hitters
      // (Sarasota 4804, Hillsborough 4830…) surface without scrolling
      customs.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
      return [...entries.values(), ...customs]
    },
  })
}
