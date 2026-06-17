import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums, Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'

type Contact = Tables<'contacts'>
type Company = Tables<'companies'>

/**
 * A pursuit (one client chasing one property) with the relations the boards/cards need.
 * `client` is the tenant/buyer side; `tenant_company`/`tenant_contact`/`broker`/`source` are
 * convenience aliases derived from the client so existing card/panel code reads naturally.
 */
export type MatchWithRelations = Tables<'pursuits'> & {
  property: Pick<
    Tables<'properties'>,
    | 'id'
    | 'address'
    | 'city'
    | 'state'
    | 'building_sf'
    | 'source'
    | 'source_key'
    | 'listing_url'
    | 'photo_urls'
    | 'asking_rate_psf'
    | 'asking_price'
    | 'specs'
  > | null
  client:
    | (Pick<
        Tables<'clients'>,
        'id' | 'status' | 'deal_type' | 'source' | 'commission_pct' | 'company_id' | 'contact_id'
      > & {
        company: Pick<Company, 'id' | 'name'> | null
        contact: Pick<Contact, 'id' | 'first_name' | 'last_name' | 'email' | 'phone' | 'title'> | null
        broker: Pick<Contact, 'id' | 'first_name' | 'last_name'> | null
      })
    | null
  // convenience aliases (derived from client)
  tenant_company: Pick<Company, 'id' | 'name'> | null
  tenant_contact: Pick<Contact, 'id' | 'first_name' | 'last_name' | 'email' | 'phone' | 'title'> | null
  broker: Pick<Contact, 'id' | 'first_name' | 'last_name'> | null
  source: Enums<'lead_source'> | null
  /** alias of client_id, kept for call sites that route by the tenant side */
  tenant_rep_id: string
}

const MATCH_SELECT = `
  *,
  property:properties!pursuits_property_id_fkey(id, address, city, state, building_sf, source, source_key, listing_url, photo_urls, asking_rate_psf, asking_price, specs),
  client:clients!pursuits_client_id_fkey(
    id, status, deal_type, source, commission_pct, company_id, contact_id,
    company:companies!clients_company_id_fkey(id, name),
    contact:contacts!clients_contact_id_fkey(id, first_name, last_name, email, phone, title),
    broker:contacts!clients_broker_contact_id_fkey(id, first_name, last_name)
  )
`

type PursuitRow = Tables<'pursuits'> & {
  property: MatchWithRelations['property']
  client: MatchWithRelations['client']
}

/** Add the convenience aliases the UI reads (tenant identity derived from the client). */
function decorate(row: PursuitRow): MatchWithRelations {
  return {
    ...row,
    tenant_company: row.client?.company ?? null,
    tenant_contact: row.client?.contact ?? null,
    broker: row.client?.broker ?? null,
    source: row.client?.source ?? null,
    tenant_rep_id: row.client_id,
  }
}

export const listingMatchesKey = (listingId: string) => ['matches', 'listing', listingId]
export const tenantRepMatchesKey = (tenantRepId: string) => ['matches', 'tenant_rep', tenantRepId]
export const propertyMatchesKey = (propertyId: string) => ['matches', 'property', propertyId]

/** Pursuits on a property (the prospects shown on a landlord/property board). */
export function usePropertyMatches(propertyId: string | undefined) {
  return useQuery({
    queryKey: propertyMatchesKey(propertyId ?? ''),
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pursuits')
        .select(MATCH_SELECT)
        .eq('property_id', propertyId!)
        .order('inquiry_date', { ascending: false })
      if (error) throw error
      return (data as unknown as PursuitRow[]).map(decorate)
    },
  })
}

/** Pursuits for a client — the properties in play shown on a tenant board. */
export function useTenantRepMatches(clientId: string | undefined) {
  return useQuery({
    queryKey: tenantRepMatchesKey(clientId ?? ''),
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pursuits')
        .select(MATCH_SELECT)
        .eq('client_id', clientId!)
        .order('inquiry_date', { ascending: false })
      if (error) throw error
      return (data as unknown as PursuitRow[]).map(decorate)
    },
  })
}

export function useMatch(id: string | undefined) {
  return useQuery({
    queryKey: ['match', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pursuits')
        .select(MATCH_SELECT)
        .eq('id', id!)
        .single()
      if (error) throw error
      return decorate(data as unknown as PursuitRow)
    },
  })
}

function invalidateMatchViews(queryClient: ReturnType<typeof useQueryClient>) {
  // pursuits drive both boards' cards and the level-1 boards' aggregate counts
  queryClient.invalidateQueries({ queryKey: ['matches'] })
  queryClient.invalidateQueries({ queryKey: ['match'] })
  queryClient.invalidateQueries({ queryKey: ['listings'] })
  queryClient.invalidateQueries({ queryKey: ['listing'] })
  queryClient.invalidateQueries({ queryKey: ['tenant_reps'] })
  queryClient.invalidateQueries({ queryKey: ['tenant_rep'] })
}

export function useCreateMatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: TablesInsert<'pursuits'>) => {
      const { data, error } = await supabase.from('pursuits').insert(values).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => invalidateMatchViews(queryClient),
  })
}

export function useUpdateMatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: TablesUpdate<'pursuits'> & { id: string }) => {
      const { data, error } = await supabase
        .from('pursuits')
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

/** Remove a pursuit (e.g. drop a property from a client's list). */
export function useDeleteMatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('pursuits').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidateMatchViews(queryClient),
  })
}

/**
 * Optimistically move a pursuit to a new stage on the board identified by `boardKey`
 * (also accepts an extra patch, e.g. tour_date when dropping onto Touring).
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
      stage: Enums<'pursuit_stage'>
      patch?: Partial<TablesUpdate<'pursuits'>>
    }) => {
      const { error } = await supabase
        .from('pursuits')
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

/** Promote a pursuit's client to an active (signed) client. Returns the client. */
export function usePromoteToTenantRep() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ clientId }: { clientId: string }) => {
      const { data, error } = await supabase.rpc('promote_client', { p_client_id: clientId })
      if (error) throw error
      return data
    },
    onSuccess: () => invalidateMatchViews(queryClient),
  })
}

/** Mark a pursuit executed + write its comp via the execute_pursuit RPC. */
export function useExecutePursuit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ pursuitId, terms }: { pursuitId: string; terms?: Record<string, unknown> }) => {
      const { data, error } = await supabase.rpc('execute_pursuit', {
        p_pursuit_id: pursuitId,
        p: (terms ?? {}) as never,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => invalidateMatchViews(queryClient),
  })
}
