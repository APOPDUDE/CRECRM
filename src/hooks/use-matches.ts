import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { fetchCurrentAsking } from '@/hooks/use-comps'
import type { Enums, Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'

type Contact = Tables<'contacts'>
type Company = Tables<'companies'>

/**
 * A pursuit (one client chasing one property) with the relations the boards/cards need.
 * `client` is the tenant/buyer side; `tenant_company`/`tenant_contact`/`broker`/`source` are
 * convenience aliases derived from the client so existing card/panel code reads naturally.
 */
export type MatchWithRelations = Tables<'pursuits'> & {
  property:
    | (Pick<
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
        | 'specs'
      > & {
        // current asking, merged from the comps time-series (not columns on properties)
        asking_rate_psf: number | null
        asking_price: number | null
      })
    | null
  client:
    | (Pick<
        Tables<'clients'>,
        | 'id'
        | 'status'
        | 'deal_type'
        | 'source'
        | 'commission_pct'
        | 'company_id'
        | 'contact_id'
        | 'intended_use'
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
  property:properties!pursuits_property_id_fkey(id, address, city, state, building_sf, source, source_key, listing_url, photo_urls, specs),
  client:clients!pursuits_client_id_fkey(
    id, status, deal_type, source, commission_pct, company_id, contact_id, intended_use,
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

/**
 * Merge each match's current asking (from the comps time-series) onto its property.
 * Pricing no longer lives on `properties`, so the embed can't carry it — one extra
 * query per board folds it back in by property_id.
 */
async function withAsking(rows: MatchWithRelations[]): Promise<MatchWithRelations[]> {
  const ids = rows.map((r) => r.property?.id).filter((x): x is string => !!x)
  if (ids.length === 0) return rows
  const asking = await fetchCurrentAsking(ids)
  return rows.map((r) =>
    r.property
      ? {
          ...r,
          property: {
            ...r.property,
            asking_rate_psf: asking.get(r.property.id)?.rate ?? null,
            asking_price: asking.get(r.property.id)?.price ?? null,
          },
        }
      : r,
  )
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
        .order('sort_order', { ascending: true })
      if (error) throw error
      return withAsking((data as unknown as PursuitRow[]).map(decorate))
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
        .order('sort_order', { ascending: true })
      if (error) throw error
      return withAsking((data as unknown as PursuitRow[]).map(decorate))
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
      return (await withAsking([decorate(data as unknown as PursuitRow)]))[0]
    },
  })
}

export function invalidateMatchViews(queryClient: ReturnType<typeof useQueryClient>) {
  // pursuits drive both boards' cards and the level-1 boards' aggregate counts
  queryClient.invalidateQueries({ queryKey: ['matches'] })
  queryClient.invalidateQueries({ queryKey: ['match'] })
  queryClient.invalidateQueries({ queryKey: ['listings'] })
  queryClient.invalidateQueries({ queryKey: ['listing'] })
  queryClient.invalidateQueries({ queryKey: ['tenant_reps'] })
  queryClient.invalidateQueries({ queryKey: ['tenant_rep'] })
}

/**
 * Which side of the flip board a new pursuit should land on. An unambiguous client or
 * listing (lease-only, sale-only) decides it outright. When they work both, the
 * property's own asking terms decide — a sale price alone means the sale board, a lease
 * rate alone the lease board — and anything priced for either way (or not priced at all)
 * follows the board you were looking at. Always overridable from the card afterwards.
 *
 * Mirrors `derive_pursuit_deal_type()` in Postgres, which covers the automation path;
 * this adds the one thing SQL can't know — which board is on screen.
 */
export async function resolvePursuitSide(
  propertyId: string,
  parentDealType: Enums<'deal_type'> | null | undefined,
  boardSide: 'lease' | 'sale',
): Promise<'lease' | 'sale'> {
  if (parentDealType === 'lease' || parentDealType === 'sale') return parentDealType
  try {
    const asking = (await fetchCurrentAsking([propertyId])).get(propertyId)
    const hasSale = asking?.price != null
    const hasLease = asking?.rate != null
    if (hasSale && !hasLease) return 'sale'
    if (hasLease && !hasSale) return 'lease'
  } catch {
    // no asking data to read — fall through to the board on screen
  }
  return boardSide
}

/**
 * `sort_order` and `deal_type` are NOT NULL on pursuits with no column default: a BEFORE
 * INSERT trigger fills each one when it arrives null. Codegen cannot see triggers, so it
 * marks both required and every caller would have to invent a value.
 *
 * Adding real column defaults would be the worse fix — both triggers key off NULL, so a
 * default would satisfy the generator by permanently stopping the triggers from firing.
 */
export type NewPursuit = Omit<TablesInsert<'pursuits'>, 'sort_order' | 'deal_type'> &
  Partial<Pick<TablesInsert<'pursuits'>, 'sort_order' | 'deal_type'>>

/** Widen a trigger-completed pursuit to the generated Insert type. See NewPursuit. */
export const asPursuitInsert = (v: NewPursuit) => v as TablesInsert<'pursuits'>

export function useCreateMatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: NewPursuit) => {
      const { data, error } = await supabase
        .from('pursuits')
        .insert(asPursuitInsert(values))
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => invalidateMatchViews(queryClient),
  })
}

/**
 * Log a texted deal onto every buyer who received it.
 *
 * The pursuit IS the record of "this buyer was shown this property", so a blast that
 * leaves no pursuit behind is a conversation you cannot report on later. Each one lands
 * at `inquiring` (the column default) and moves from there as they react.
 *
 * `(client_id, property_id)` is unique and the upsert IGNORES conflicts on purpose: if a
 * buyer already has this property — perhaps already at Touring — re-texting them must not
 * drag it back to inquiring or overwrite what you learned.
 */
export function useLogBlastPursuits() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      propertyId,
      clientIds,
      note,
      ownerId,
    }: {
      propertyId: string
      clientIds: string[]
      note: string
      ownerId: string
    }) => {
      if (!clientIds.length) return { added: 0 }
      const rows = clientIds.map((client_id) =>
        asPursuitInsert({
          owner_id: ownerId,
          client_id,
          property_id: propertyId,
          stage: 'inquiring',
          notes: note,
        }),
      )
      const { data, error } = await supabase
        .from('pursuits')
        .upsert(rows, { onConflict: 'client_id,property_id', ignoreDuplicates: true })
        .select('id')
      if (error) throw error
      return { added: data?.length ?? 0 }
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

/**
 * Move a pursuit to the other side of the flip board (lease <-> sale). The stage rides
 * along unchanged — the two pipelines share the same enum, so a deal mid-negotiation
 * stays mid-negotiation, it just gets the other side's columns and labels.
 */
export function useUpdatePursuitDealSide(boardKey: readonly unknown[]) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, dealType }: { id: string; dealType: 'lease' | 'sale' }) => {
      const { error } = await supabase.from('pursuits').update({ deal_type: dealType }).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, dealType }) => {
      await queryClient.cancelQueries({ queryKey: boardKey })
      const previous = queryClient.getQueryData<MatchWithRelations[]>(boardKey)
      queryClient.setQueryData<MatchWithRelations[]>(boardKey, (old) =>
        old?.map((m) => (m.id === id ? { ...m, deal_type: dealType } : m)),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(boardKey, context.previous)
    },
    onSettled: () => invalidateMatchViews(queryClient),
  })
}

/**
 * Move a card within its column. `before` is the card it should sit above (null = drop to
 * the bottom); the new position is the midpoint between that card and the one above it, so
 * a drop is a single row update rather than renumbering the column.
 */
export function useReorderPursuit(boardKey: readonly unknown[]) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, sortOrder }: { id: string; sortOrder: number }) => {
      const { error } = await supabase.from('pursuits').update({ sort_order: sortOrder }).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, sortOrder }) => {
      await queryClient.cancelQueries({ queryKey: boardKey })
      const previous = queryClient.getQueryData<MatchWithRelations[]>(boardKey)
      queryClient.setQueryData<MatchWithRelations[]>(boardKey, (old) =>
        old
          ?.map((m) => (m.id === id ? { ...m, sort_order: sortOrder } : m))
          .sort((a, b) => a.sort_order - b.sort_order),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(boardKey, context.previous)
    },
    onSettled: () => invalidateMatchViews(queryClient),
  })
}

/**
 * The sort_order a card should take to land directly above `before` within `columnItems`.
 * Bottom of the column => last position + 1000; otherwise the midpoint of its new
 * neighbours, which keeps every drop to one update.
 */
export function sortOrderBefore(
  columnItems: { id: string; sort_order: number }[],
  moving: { id: string },
  before: { id: string } | null,
): number {
  const others = columnItems.filter((i) => i.id !== moving.id)
  if (others.length === 0) return 1000
  if (!before) return others[others.length - 1].sort_order + 1000
  const idx = others.findIndex((i) => i.id === before.id)
  if (idx <= 0) return others[0].sort_order - 1000
  return (others[idx - 1].sort_order + others[idx].sort_order) / 2
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
