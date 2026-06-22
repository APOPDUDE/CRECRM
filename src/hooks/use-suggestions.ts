import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type Suggestion = {
  id: string
  created_at: string
  property:
    | {
        id: string
        address: string
        city: string | null
        state: string | null
        property_type: string | null
        building_sf: number | null
        listing_url: string | null
      }
    | null
  tenant_rep:
    | {
        id: string
        company: { name: string } | null
        contact: { first_name: string; last_name: string | null } | null
      }
    | null
}

// `!inner` on the client so the status filter excludes suggestions whose client has
// left the searching pool (negotiating/closed/lost no longer surface new matches).
// (alias kept as `tenant_rep` for the widget.)
const SUGGESTION_SELECT = `
  id, created_at,
  property:properties!suggestions_property_id_fkey(id, address, city, state, property_type, building_sf, listing_url),
  tenant_rep:clients!suggestions_client_id_fkey!inner(
    id,
    company:companies!clients_company_id_fkey(name),
    contact:contacts!clients_contact_id_fkey(first_name, last_name)
  )
`

/** Pending suggestions for clients still in the searching pool, newest first. */
export function usePendingSuggestions() {
  return useQuery({
    queryKey: ['suggestions', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suggestions')
        .select(SUGGESTION_SELECT)
        .eq('status', 'pending')
        .eq('tenant_rep.status', 'searching')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as Suggestion[]
    },
  })
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['suggestions'] })
  qc.invalidateQueries({ queryKey: ['matches'] })
  qc.invalidateQueries({ queryKey: ['tenant_reps'] })
}

export type SearchingClient = {
  id: string
  company: { name: string } | null
  contact: { first_name: string; last_name: string | null } | null
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

/**
 * Approve a suggestion -> creates the inquiring pursuit on a client's board. Defaults
 * to the client it was suggested for; pass clientId to add it to a different searching
 * client instead.
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
    onSuccess: () => invalidate(qc),
  })
}

/** Dismiss a suggestion (kept as 'dismissed' so the sweep won't re-suggest it). */
export function useDismissSuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('suggestions')
        .update({ status: 'dismissed' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}
