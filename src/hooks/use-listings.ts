import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'

const LISTING_SELECT = `
  *,
  property:properties!listings_property_id_fkey(id, address, city, state, property_type),
  landlord:companies!listings_landlord_company_id_fkey(id, name),
  broker:contacts!listings_broker_contact_id_fkey(id, first_name, last_name),
  matches(id, stage)
`

export type ListingWithRelations = Tables<'listings'> & {
  property: Pick<Tables<'properties'>, 'id' | 'address' | 'city' | 'state' | 'property_type'> | null
  landlord: Pick<Tables<'companies'>, 'id' | 'name'> | null
  broker: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
  matches: { id: string; stage: Enums<'match_stage'> }[]
}

export function useListings() {
  return useQuery({
    queryKey: ['listings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listings')
        .select(LISTING_SELECT)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as ListingWithRelations[]
    },
  })
}

export function useCreateListing() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: TablesInsert<'listings'>) => {
      const { data, error } = await supabase.from('listings').insert(values).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['listings'] }),
  })
}

export function useUpdateListing() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: TablesUpdate<'listings'> & { id: string }) => {
      const { data, error } = await supabase
        .from('listings')
        .update(values)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['listings'] }),
  })
}

/** Mark a listing lost, optionally killing its open prospect matches too. */
export function useMarkListingLost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      lostReason,
      markMatchesDead,
    }: {
      id: string
      lostReason: string | null
      markMatchesDead: boolean
    }) => {
      const { error } = await supabase
        .from('listings')
        .update({ status: 'lost', lost_reason: lostReason })
        .eq('id', id)
      if (error) throw error
      if (markMatchesDead) {
        const { error: matchError } = await supabase
          .from('matches')
          .update({ stage: 'dead' })
          .eq('listing_id', id)
          .neq('stage', 'dead')
        if (matchError) throw matchError
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['listings'] })
      queryClient.invalidateQueries({ queryKey: ['matches'] })
    },
  })
}

export function useReopenListing() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('listings')
        .update({ status: 'active', lost_reason: null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['listings'] }),
  })
}

/** Move a listing to a new stage, optimistically (card moves instantly, rolls back on error). */
export function useUpdateListingStage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: Enums<'listing_stage'> }) => {
      const { error } = await supabase.from('listings').update({ stage }).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, stage }) => {
      await queryClient.cancelQueries({ queryKey: ['listings'] })
      const previous = queryClient.getQueryData<ListingWithRelations[]>(['listings'])
      queryClient.setQueryData<ListingWithRelations[]>(['listings'], (old) =>
        old?.map((l) => (l.id === id ? { ...l, stage } : l)),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['listings'], context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['listings'] }),
  })
}
