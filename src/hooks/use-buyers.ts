import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type PropertyPoint = {
  id: string
  address: string
  city: string | null
  state: string | null
  lat: number | null
  lng: number | null
}

/**
 * Address search that returns coordinates, for the Buyers page's "who buys here?" check:
 * pick the property a deal just landed on, and the roster narrows to the buyers whose
 * drawn areas contain it.
 */
export function usePropertyPointSearch(query: string) {
  const q = query.replace(/[,()]/g, ' ').trim()
  return useQuery({
    queryKey: ['buyer-property-search', q],
    enabled: q.length >= 3,
    queryFn: async (): Promise<PropertyPoint[]> => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, address, city, state, lat, lng')
        .ilike('address', `%${q}%`)
        .order('address')
        .limit(8)
      if (error) throw error
      return (data ?? []) as PropertyPoint[]
    },
  })
}
