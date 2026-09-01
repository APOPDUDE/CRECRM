import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { TargetArea } from '@/lib/clients'

/**
 * The county/city boundary library (public.named_areas, loaded from Census
 * cartographic files). Typing "Lakeland" on a buyer resolves to a real polygon
 * through these — the list is names only; rings are fetched on selection.
 */
export type NamedAreaOption = {
  id: string
  kind: 'county' | 'city'
  name: string
  county: string | null
}

export function useNamedAreaList() {
  return useQuery({
    queryKey: ['named-areas'],
    staleTime: Infinity,
    queryFn: async (): Promise<NamedAreaOption[]> => {
      const out: NamedAreaOption[] = []
      // PostgREST caps any response at 1000 rows and the library is ~1,022 —
      // page until a short page, or the tail of the alphabet silently vanishes.
      for (let page = 0; page < 5; page++) {
        const { data, error } = await supabase
          .from('named_areas')
          .select('id, kind, name, county')
          .order('kind', { ascending: false })
          .order('name')
          .range(page * 1000, page * 1000 + 999)
        if (error) throw error
        out.push(...((data ?? []) as NamedAreaOption[]))
        if (!data || data.length < 1000) break
      }
      return out
    },
  })
}

/**
 * One named area's rings as TargetArea entries — one per polygon part, suffixed
 * #2+ past the first, the same naming resolve_named_areas() uses server-side.
 */
export async function fetchNamedAreaTargets(id: string): Promise<TargetArea[]> {
  const { data, error } = await supabase
    .from('named_areas')
    .select('name, rings')
    .eq('id', id)
    .single()
  if (error) throw error
  const rings = Array.isArray(data.rings) ? data.rings : []
  const out: TargetArea[] = []
  rings.forEach((ring, i) => {
    if (!Array.isArray(ring) || ring.length < 3) return
    const points: [number, number][] = []
    for (const p of ring) {
      if (!Array.isArray(p) || p.length < 2) continue
      const lat = Number(p[0])
      const lng = Number(p[1])
      if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng])
    }
    if (points.length >= 3)
      out.push({ name: i > 0 ? `${data.name} #${i + 1}` : data.name, ring: points })
  })
  return out
}
