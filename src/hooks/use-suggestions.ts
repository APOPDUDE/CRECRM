import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Enums } from '@/lib/database.types'
import type { CurrentAsking } from '@/hooks/use-comps'

export type SuggestionProperty = {
  id: string
  address: string
  city: string | null
  state: string | null
  property_type: Enums<'property_kind'> | null
  building_sf: number | null
  land_acres: number | null
  listing_url: string | null
  created_at: string
}

export type SuggestionClient = {
  id: string
  property_type: Enums<'property_kind'> | null
  deal_type: string | null
  building_sf_min: number | null
  building_sf_max: number | null
  target_markets: string | null
  company: { name: string } | null
  contact: { first_name: string; last_name: string | null } | null
}

export type Suggestion = {
  id: string
  created_at: string
  property: SuggestionProperty | null
  client: SuggestionClient | null
}

// `!inner` on the client so the status filter excludes suggestions whose client has
// left the searching pool (negotiating/closed/lost no longer surface new matches).
const SUGGESTION_SELECT = `
  id, created_at,
  property:properties!suggestions_property_id_fkey(
    id, address, city, state, property_type, building_sf, land_acres, listing_url, created_at
  ),
  client:clients!suggestions_client_id_fkey!inner(
    id, property_type, deal_type, building_sf_min, building_sf_max, target_markets,
    company:companies!clients_company_id_fkey(name),
    contact:contacts!clients_contact_id_fkey(first_name, last_name)
  )
`

/**
 * Hard ceiling on how many pending suggestions the dashboard loads. Explicit, because
 * PostgREST's max-rows default (1000) would otherwise truncate SILENTLY — better to own
 * the number and keep the asking-price fan-out bounded. Triage or bulk-dismiss to see more.
 */
export const PENDING_SUGGESTIONS_CAP = 500

/** Pending suggestions for clients still in the searching pool, newest first. */
export function usePendingSuggestions() {
  return useQuery({
    queryKey: ['suggestions', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suggestions')
        .select(SUGGESTION_SELECT)
        .eq('status', 'pending')
        .eq('client.status', 'searching')
        .order('created_at', { ascending: false })
        .limit(PENDING_SUGGESTIONS_CAP)
      if (error) throw error
      return data as unknown as Suggestion[]
    },
  })
}

/**
 * Rank a suggestion for display: SF fit inside the client's band beats the stretch
 * zone, a specific market beats a wildcard, an exact type match beats a wildcard,
 * newer listings break ties. Pure presentation — the hard matching rules already
 * ran in cross_reference. For lease clients the fit is judged on the AVAILABLE space
 * (the current asking comp's sf) when known, matching cross_reference — a 200k SF
 * building with a 25k SF suite is a dead-center fit for a 20-30k client, not a miss.
 */
export function scoreSuggestion(s: Suggestion, asking?: CurrentAsking): number {
  const p = s.property
  const c = s.client
  if (!p || !c) return 0
  let score = 0

  const sf = c.deal_type === 'sale' ? p.building_sf : (asking?.sf ?? p.building_sf)
  const min = c.building_sf_min
  const max = c.building_sf_max
  if (sf != null && (min != null || max != null)) {
    const insideBand = (min == null || sf >= min) && (max == null || sf <= max)
    if (insideBand) {
      score += 40
      if (min != null && max != null) {
        const mid = (min + max) / 2
        const half = Math.max((max - min) / 2, 1)
        score += 10 * (1 - Math.min(Math.abs(sf - mid) / half, 1))
      }
    } else {
      score += 15 // matched only via the 0.8x/1.25x stretch zone
    }
  }

  if (c.target_markets && p.city) score += 25 // matched a named market, not a wildcard
  if (c.property_type && p.property_type === c.property_type) score += 15

  const ageDays = (Date.now() - new Date(p.created_at).getTime()) / 86_400_000
  score += 10 * Math.max(0, 1 - ageDays / 30)
  return score
}

/** Display name for a client (company first, else contact, else fallback). */
export function clientLabel(c: {
  company?: { name: string } | null
  contact?: { first_name: string; last_name: string | null } | null
} | null): string {
  if (c?.company?.name) return c.company.name
  if (c?.contact) {
    const n = [c.contact.first_name, c.contact.last_name].filter(Boolean).join(' ')
    if (n) return n
  }
  return 'Unnamed client'
}

export type SearchingClient = {
  id: string
  company: { name: string } | null
  contact: { first_name: string; last_name: string | null } | null
}

/** All clients still in the searching pool — the choices for "add suggestion to". */
export function useSearchingClients() {
  return useQuery({
    queryKey: ['clients', 'searching'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select(
          'id, company:companies!clients_company_id_fkey(name), contact:contacts!clients_contact_id_fkey(first_name, last_name)',
        )
        .eq('status', 'searching')
      if (error) throw error
      const rows = data as unknown as SearchingClient[]
      return [...rows].sort((a, b) => clientLabel(a).localeCompare(clientLabel(b)))
    },
  })
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['suggestions'] })
  qc.invalidateQueries({ queryKey: ['matches'] })
  qc.invalidateQueries({ queryKey: ['tenant_reps'] })
  // Accepting creates a flagged-new inquiring pursuit — the activity feed and "New
  // matches" count on the same dashboard page must move with it.
  qc.invalidateQueries({ queryKey: ['dashboard-matches'] })
}

/**
 * Optimistically drop rows from the pending cache so accepted/dismissed suggestions
 * leave the screen on tap (and a double-tap can't hit approve_suggestion twice —
 * the RPC deletes the row, so a second call would error "suggestion not found").
 * Returns the previous cache for rollback on error.
 */
async function removePendingOptimistically(
  qc: ReturnType<typeof useQueryClient>,
  ids: string[],
): Promise<{ prev: Suggestion[] | undefined }> {
  await qc.cancelQueries({ queryKey: ['suggestions', 'pending'] })
  const prev = qc.getQueryData<Suggestion[]>(['suggestions', 'pending'])
  qc.setQueryData<Suggestion[]>(['suggestions', 'pending'], (old) =>
    old?.filter((s) => !ids.includes(s.id)),
  )
  return { prev }
}

/**
 * Accept a suggestion -> creates the inquiring pursuit on the client's board and
 * removes the suggestion. Pass clientId to add it to a different searching client.
 */
export function useApproveSuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, clientId }: { id: string; clientId?: string }) => {
      const { error } = await supabase.rpc('approve_suggestion', {
        p_suggestion_id: id,
        ...(clientId ? { p_client_id: clientId } : {}),
      })
      if (error) throw error
    },
    onMutate: ({ id }) => removePendingOptimistically(qc, [id]),
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['suggestions', 'pending'], ctx.prev)
    },
    onSettled: () => invalidate(qc),
  })
}

/** Dismiss suggestions (kept as 'dismissed' so the sweep won't re-suggest the pair). */
export function useDismissSuggestions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('suggestions')
        .update({ status: 'dismissed' })
        .in('id', ids)
      if (error) throw error
    },
    onMutate: (ids) => removePendingOptimistically(qc, ids),
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['suggestions', 'pending'], ctx.prev)
    },
    onSettled: () => invalidate(qc),
  })
}

/**
 * Undo for Dismiss: dismissal is otherwise permanent (dismissed pairs are never
 * re-suggested), so the dismiss toast offers to flip the rows back to pending.
 */
export function useRestoreSuggestions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('suggestions')
        .update({ status: 'pending' })
        .in('id', ids)
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}

/**
 * Cross-reference the last two weeks of new on-market listings against the searching
 * pool. Returns the number of suggestions created. (The Sunday sweep also runs this
 * automatically for each import batch.)
 */
export function useRefreshSuggestions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('refresh_suggestions', { p_days: 14 })
      if (error) throw error
      return (data as { suggestions_created?: number } | null)?.suggestions_created ?? 0
    },
    onSuccess: () => invalidate(qc),
  })
}
