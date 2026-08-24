import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tables } from '@/lib/database.types'

export type ParcelEnrichment = Tables<'parcel_enrichment'>

/**
 * Site intelligence for one parcel. Absent until the enrichment pass has
 * reached that county, so the card treats "no row" as "not measured yet"
 * rather than as an error.
 */
export function useParcelEnrichment(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['parcel-enrichment', propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parcel_enrichment')
        .select('*')
        .eq('property_id', propertyId!)
        .maybeSingle()
      if (error) throw error
      return data as ParcelEnrichment | null
    },
  })
}
