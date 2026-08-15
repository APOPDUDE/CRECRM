import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * The crossover codes: zoning that ALLOWS industrial without being industrial-primary
 * (Hillsborough CG/CI, Polk BPC — Alex's "can be both" call, 2026-08-15).
 *
 * "Zoned industrial" in every filter means `zoning_type === 'industrial' OR crossover`.
 * Only the handful of crossover rows ship to the client; the industrial-primary case is
 * already on the property row itself.
 */
export function useIndustrialCrossovers() {
  return useQuery({
    queryKey: ['zoning-crossovers'],
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zoning_code_map')
        .select('jurisdiction, code')
        .eq('allows_industrial', true)
        .neq('zoning_type', 'industrial')
      if (error) throw error
      return new Set((data ?? []).map((r) => `${r.jurisdiction}|${r.code}`))
    },
  })
}

export function isZonedIndustrial(
  p: { zoning_type: string | null; zoning_jurisdiction: string | null; zoning_code: string | null },
  crossovers: Set<string> | undefined,
): boolean {
  if (p.zoning_type === 'industrial') return true
  if (!p.zoning_jurisdiction || !p.zoning_code) return false
  return !!crossovers?.has(`${p.zoning_jurisdiction}|${p.zoning_code}`)
}
