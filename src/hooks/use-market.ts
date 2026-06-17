import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

export type CountyMarketStats = Database['public']['Views']['v_county_market_stats']['Row']
export type PropertyMarketPosition = Database['public']['Views']['v_property_market_position']['Row']

/** County-wide market baseline (the `property_type is null` rollup row) for a county. */
export function useCountyMarketStats(county: string | null | undefined) {
  return useQuery({
    queryKey: ['county-market-stats', county],
    enabled: !!county,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_county_market_stats')
        .select('*')
        .eq('county', county!)
        .is('property_type', null)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

/** A single property's position vs its county market + good-deal flags. */
export function usePropertyMarketPosition(id: string | null | undefined) {
  return useQuery({
    queryKey: ['property-market-position', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_property_market_position')
        .select('*')
        .eq('id', id!)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

/** Set of property ids the system flags as a good lease or sale deal (for list badges). */
export function useGoodDealIds() {
  return useQuery({
    queryKey: ['good-deal-ids'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_property_market_position')
        .select('id, good_lease_deal, good_sale_deal')
        .or('good_lease_deal.eq.true,good_sale_deal.eq.true')
      if (error) throw error
      const ids = new Set<string>()
      for (const row of data ?? []) {
        if (row.id && (row.good_lease_deal || row.good_sale_deal)) ids.add(row.id)
      }
      return ids
    },
  })
}

/** Has the system flagged a good deal of any kind on this position row? */
export function isGoodDeal(p: PropertyMarketPosition | null | undefined): boolean {
  return !!(p && (p.good_lease_deal || p.good_sale_deal))
}
