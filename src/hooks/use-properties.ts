import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'

export type Property = Tables<'properties'>

/** Property plus embedded linked-deal counts (listings + matches). */
export type PropertyWithCounts = Property & {
  listings: { count: number }[]
  matches: { count: number }[]
}

/** Total linked deals on a property: landlord listings + tenant matches. */
export function dealCount(p: Pick<PropertyWithCounts, 'listings' | 'matches'>): number {
  return (p.listings?.[0]?.count ?? 0) + (p.matches?.[0]?.count ?? 0)
}

export function useProperties() {
  return useQuery({
    queryKey: ['properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('*, listings(count), matches(count)')
        .order('address')
      if (error) throw error
      return data as unknown as PropertyWithCounts[]
    },
  })
}

export type PropertyListing = Pick<
  Tables<'listings'>,
  'id' | 'deal_type' | 'stage' | 'status' | 'asking_rate_psf' | 'asking_price' | 'lost_reason'
> & {
  landlord: Pick<Tables<'companies'>, 'id' | 'name'> | null
}

export type PropertyMatch = Pick<
  Tables<'matches'>,
  'id' | 'stage' | 'flagged_new' | 'tenant_rep_id' | 'listing_id' | 'inquiry_date'
> & {
  tenant_company: Pick<Tables<'companies'>, 'id' | 'name'> | null
  tenant_contact: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
}

/** Landlord listings + tenant matches tied to a property — its association view. */
export function usePropertyDeals(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['property-deals', propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const [listingsRes, matchesRes] = await Promise.all([
        supabase
          .from('listings')
          .select(
            'id, deal_type, stage, status, asking_rate_psf, asking_price, lost_reason, landlord:companies!listings_landlord_company_id_fkey(id, name)',
          )
          .eq('property_id', propertyId!)
          .order('created_at', { ascending: false }),
        supabase
          .from('matches')
          .select(
            'id, stage, flagged_new, tenant_rep_id, listing_id, inquiry_date, tenant_company:companies!matches_tenant_company_id_fkey(id, name), tenant_contact:contacts!matches_tenant_contact_id_fkey(id, first_name, last_name)',
          )
          .eq('property_id', propertyId!)
          .order('inquiry_date', { ascending: false }),
      ])
      if (listingsRes.error) throw listingsRes.error
      if (matchesRes.error) throw matchesRes.error
      return {
        listings: (listingsRes.data ?? []) as unknown as PropertyListing[],
        matches: (matchesRes.data ?? []) as unknown as PropertyMatch[],
      }
    },
  })
}

/** The asking figure to show for a property: PSF rate (lease) or total price (sale). */
export function propertyAsking(p: Pick<Property, 'asking_rate_psf' | 'asking_price'>): {
  rate: number | null
  price: number | null
} {
  return { rate: p.asking_rate_psf, price: p.asking_price }
}

export type MatchStage = Enums<'match_stage'>

export function useProperty(id: string | undefined) {
  return useQuery({
    queryKey: ['properties', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('properties').select('*').eq('id', id!).single()
      if (error) throw error
      return data
    },
  })
}

export function useCreateProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: TablesInsert<'properties'>) => {
      const { data, error } = await supabase.from('properties').insert(values).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['properties'] }),
  })
}

export function useUpdateProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: TablesUpdate<'properties'> & { id: string }) => {
      const { data, error } = await supabase.from('properties').update(values).eq('id', id).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['properties'] }),
  })
}

export function useDeleteProperty() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('properties').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['properties'] }),
  })
}
