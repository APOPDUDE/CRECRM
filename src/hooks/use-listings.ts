import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'

export type ListingWithRelations = Tables<'listings'> & {
  property: Pick<Tables<'properties'>, 'id' | 'address' | 'city' | 'state' | 'property_type'> | null
  landlord: Pick<Tables<'companies'>, 'id' | 'name'> | null
  broker: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
  /** pursuits on this listing's property (the prospects), for the count badge */
  matches: { id: string; stage: Enums<'pursuit_stage'> }[]
}

const LISTING_SELECT = `
  *,
  property:properties!listings_property_id_fkey(id, address, city, state, property_type),
  landlord:companies!listings_landlord_company_id_fkey(id, name),
  broker:contacts!listings_broker_contact_id_fkey(id, first_name, last_name)
`

export function useListings() {
  return useQuery({
    queryKey: ['listings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listings')
        .select(LISTING_SELECT)
        .order('created_at', { ascending: false })
      if (error) throw error
      const listings = (data ?? []) as unknown as Omit<ListingWithRelations, 'matches'>[]

      // a listing's prospects = pursuits on the same property (no listing_id on pursuits)
      const propertyIds = [...new Set(listings.map((l) => l.property_id))]
      const byProperty = new Map<string, { id: string; stage: Enums<'pursuit_stage'> }[]>()
      if (propertyIds.length) {
        const { data: pursuits, error: pErr } = await supabase
          .from('pursuits')
          .select('id, stage, property_id')
          .in('property_id', propertyIds)
        if (pErr) throw pErr
        for (const p of pursuits ?? []) {
          const arr = byProperty.get(p.property_id) ?? []
          arr.push({ id: p.id, stage: p.stage })
          byProperty.set(p.property_id, arr)
        }
      }
      return listings.map((l) => ({ ...l, matches: byProperty.get(l.property_id) ?? [] }))
    },
  })
}

const LISTING_DETAIL_SELECT = `
  *,
  property:properties!listings_property_id_fkey(*),
  landlord:companies!listings_landlord_company_id_fkey(id, name, phone),
  landlord_contact:contacts!listings_landlord_contact_id_fkey(id, first_name, last_name, title, email, phone),
  broker:contacts!listings_broker_contact_id_fkey(id, first_name, last_name)
`

export type ListingDetail = Tables<'listings'> & {
  property: Tables<'properties'> | null
  landlord: Pick<Tables<'companies'>, 'id' | 'name' | 'phone'> | null
  landlord_contact: Pick<
    Tables<'contacts'>,
    'id' | 'first_name' | 'last_name' | 'title' | 'email' | 'phone'
  > | null
  broker: Pick<Tables<'contacts'>, 'id' | 'first_name' | 'last_name'> | null
}

/** Single listing with full relations for the property-board sidebar. */
export function useListingDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['listing', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listings')
        .select(LISTING_DETAIL_SELECT)
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as ListingDetail
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['listings'] })
      if (data?.id) queryClient.invalidateQueries({ queryKey: ['listing', data.id] })
    },
  })
}

/** Mark a listing lost, optionally marking its open prospect pursuits passed. */
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
      const { data: listing, error: selErr } = await supabase
        .from('listings')
        .select('property_id')
        .eq('id', id)
        .single()
      if (selErr) throw selErr
      const { error } = await supabase
        .from('listings')
        .update({ status: 'lost', lost_reason: lostReason })
        .eq('id', id)
      if (error) throw error
      if (markMatchesDead && listing?.property_id) {
        const { error: pErr } = await supabase
          .from('pursuits')
          .update({ stage: 'passed' })
          .eq('property_id', listing.property_id)
          .neq('stage', 'passed')
        if (pErr) throw pErr
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
