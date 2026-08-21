import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * property_id -> latest transfer-comp sale date, one jsonb map from Postgres (immune to the
 * PostgREST row cap). Drives the War Room "hide recently sold" filter — an owner who just
 * closed is the worst cold call on the map.
 *
 * Coverage is PARTIAL by nature (Hillsborough ~27%, Polk ~48% of properties carry any recorded
 * sale), so absence means "no recorded sale", never "never sold" — which is why the filter
 * pairs with an "include properties with no sold date" toggle, default on.
 */
export function useLastSales(enabled: boolean) {
  return useQuery({
    queryKey: ['property-last-sales'],
    enabled,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase.rpc('property_last_sales')
      if (error) throw error
      return new Map(Object.entries((data ?? {}) as Record<string, string>))
    },
  })
}
