import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'

type Contact = Tables<'contacts'>
type Company = Tables<'companies'>

export type MatchWithRelations = Tables<'matches'> & {
  property: Pick<Tables<'properties'>, 'id' | 'address' | 'city' | 'state' | 'building_sf'> | null
  listing: Pick<
    Tables<'listings'>,
    'id' | 'deal_type' | 'commission_pct' | 'co_broke_split_pct'
  > | null
  tenant_company: Pick<Company, 'id' | 'name'> | null
  tenant_contact: Pick<Contact, 'id' | 'first_name' | 'last_name' | 'email' | 'phone' | 'title'> | null
  broker: Pick<Contact, 'id' | 'first_name' | 'last_name'> | null
}

const MATCH_SELECT = `
  *,
  property:properties!matches_property_id_fkey(id, address, city, state, building_sf),
  listing:listings!matches_listing_id_fkey(id, deal_type, commission_pct, co_broke_split_pct),
  tenant_company:companies!matches_tenant_company_id_fkey(id, name),
  tenant_contact:contacts!matches_tenant_contact_id_fkey(id, first_name, last_name, email, phone, title),
  broker:contacts!matches_broker_contact_id_fkey(id, first_name, last_name)
`

export const listingMatchesKey = (listingId: string) => ['matches', 'listing', listingId]
export const tenantRepMatchesKey = (tenantRepId: string) => ['matches', 'tenant_rep', tenantRepId]

/** Matches on a listing — the prospects shown on a property board. */
export function useListingMatches(listingId: string | undefined) {
  return useQuery({
    queryKey: listingMatchesKey(listingId ?? ''),
    enabled: !!listingId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select(MATCH_SELECT)
        .eq('listing_id', listingId!)
        .order('inquiry_date', { ascending: false })
      if (error) throw error
      return data as unknown as MatchWithRelations[]
    },
  })
}

/** Matches for a tenant rep — the properties in play shown on a tenant board. */
export function useTenantRepMatches(tenantRepId: string | undefined) {
  return useQuery({
    queryKey: tenantRepMatchesKey(tenantRepId ?? ''),
    enabled: !!tenantRepId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select(MATCH_SELECT)
        .eq('tenant_rep_id', tenantRepId!)
        .order('inquiry_date', { ascending: false })
      if (error) throw error
      return data as unknown as MatchWithRelations[]
    },
  })
}

export function useMatch(id: string | undefined) {
  return useQuery({
    queryKey: ['match', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('matches').select(MATCH_SELECT).eq('id', id!).single()
      if (error) throw error
      return data as unknown as MatchWithRelations
    },
  })
}

function invalidateMatchViews(queryClient: ReturnType<typeof useQueryClient>) {
  // matches drive both boards' cards and the level-1 boards' aggregate counts
  queryClient.invalidateQueries({ queryKey: ['matches'] })
  queryClient.invalidateQueries({ queryKey: ['match'] })
  queryClient.invalidateQueries({ queryKey: ['listings'] })
  queryClient.invalidateQueries({ queryKey: ['tenant_reps'] })
}

export function useCreateMatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: TablesInsert<'matches'>) => {
      const { data, error } = await supabase.from('matches').insert(values).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => invalidateMatchViews(queryClient),
  })
}

export function useUpdateMatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: TablesUpdate<'matches'> & { id: string }) => {
      const { data, error } = await supabase
        .from('matches')
        .update(values)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => invalidateMatchViews(queryClient),
  })
}

/** Remove a match (e.g. drop a property from a tenant's inquiry list). */
export function useDeleteMatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('matches').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidateMatchViews(queryClient),
  })
}

/**
 * Optimistically move a match to a new stage on the board identified by `boardKey`
 * (also accepts an extra patch, e.g. tour_date when dropping onto Toured).
 */
export function useUpdateMatchStage(boardKey: readonly unknown[]) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      stage,
      patch,
    }: {
      id: string
      stage: Enums<'match_stage'>
      patch?: Partial<TablesUpdate<'matches'>>
    }) => {
      const { error } = await supabase
        .from('matches')
        .update({ stage, ...patch })
        .eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, stage, patch }) => {
      await queryClient.cancelQueries({ queryKey: boardKey })
      const previous = queryClient.getQueryData<MatchWithRelations[]>(boardKey)
      queryClient.setQueryData<MatchWithRelations[]>(boardKey, (old) =>
        old?.map((m) => (m.id === id ? { ...m, stage, ...patch } : m)),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(boardKey, context.previous)
    },
    onSettled: () => invalidateMatchViews(queryClient),
  })
}

/** Promote a match's tenant to a full tenant rep (atomic RPC); returns the new tenant_rep id. */
export function usePromoteToTenantRep() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ matchId, owner }: { matchId: string; owner: string }) => {
      const { data, error } = await supabase.rpc('promote_match_to_tenant_rep', {
        p_match_id: matchId,
        p_owner: owner,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => invalidateMatchViews(queryClient),
  })
}
